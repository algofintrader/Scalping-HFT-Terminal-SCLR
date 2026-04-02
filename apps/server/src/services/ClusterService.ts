import Decimal from 'decimal.js';
import { binanceClient, type BinanceCallback } from '../binance/client';
import { orderBookService, type PriceGridBounds } from './OrderBookService';
import { viewportManager } from './ViewportManager';
import type {
  ClusterCell,
  ClustersResyncV2,
  ClustersDeltaV2,
  SupportedSymbol,
} from '@sclr/shared';
import {
  CLUSTER_INTERVAL_MS,
  BinanceAggTradeSchema,
  type BinanceAggTrade,
} from '@sclr/shared';

const MAX_COLUMNS = 6; // Store 30 minutes of history (6 x 5 min)
const BROADCAST_INTERVAL_MS = 100; // Send delta every 100ms
const EXPAND_TICKS = 100; // Expand by 100 ticks when exceeding bounds

interface ClusterState {
  symbol: SupportedSymbol;
  // openTime -> { price -> cell }
  columns: Map<number, Map<string, ClusterCell>>;
  currentOpenTime: number;
  pendingUpdates: Map<string, ClusterCell>; // Accumulated updates for current column

  minPrice: Decimal;
  maxPrice: Decimal;
  tickSize: Decimal;
  pricePrecision: number;
  boundsInitialized: boolean;

  serverRevision: number;
  lastBroadcastRevisionV2: number; // V2: last broadcast revision
}

class ClusterService {
  private clusters = new Map<SupportedSymbol, ClusterState>();
  private broadcastIntervals = new Map<SupportedSymbol, ReturnType<typeof setInterval>>();
  private callbacks = new Map<SupportedSymbol, BinanceCallback>(); // Store callbacks for proper cleanup
  private unsubscribeBounds: (() => void) | null = null;

  private backgroundSymbols = new Set<SupportedSymbol>();

  private broadcastCallback: ((clientId: string, message: any) => void) | null = null;

  constructor() {
    this.unsubscribeBounds = orderBookService.onBoundsChange((symbol, bounds) => {
      this.handleBoundsChange(symbol, bounds);
    });
  }

  setBroadcastCallback(callback: (clientId: string, message: any) => void) {
    this.broadcastCallback = callback;
  }

  /**
   */
  isSubscribed(symbol: SupportedSymbol): boolean {
    return this.clusters.has(symbol);
  }

  /**
   */
  isBackgroundSymbol(symbol: SupportedSymbol): boolean {
    return this.backgroundSymbols.has(symbol);
  }

  /**
   */
  startBackgroundCollection(symbols: SupportedSymbol[]): void {
    console.log(`[Clusters] Starting background collection for ${symbols.length} symbols...`);
    for (const symbol of symbols) {
      this.backgroundSymbols.add(symbol);
      if (!this.isSubscribed(symbol)) {
        this.subscribe(symbol);
      }
    }
  }

  subscribe(symbol: SupportedSymbol): void {
    if (this.clusters.has(symbol)) return;

    console.log(`[Clusters] Subscribing to ${symbol}...`);

    const state: ClusterState = {
      symbol,
      columns: new Map(),
      currentOpenTime: 0, // Will be set by first trade
      pendingUpdates: new Map(),
      minPrice: new Decimal(0),
      maxPrice: new Decimal(0),
      tickSize: new Decimal('0.01'),
      pricePrecision: 2,
      boundsInitialized: false,
      serverRevision: 0,
      lastBroadcastRevisionV2: 0,
    };

    this.clusters.set(symbol, state);

    const bounds = orderBookService.getBounds(symbol);
    if (bounds) {
      this.initBounds(state, bounds);
    }

    const callback: BinanceCallback = (data) => {
      if (data.e === 'aggTrade') {
        const result = BinanceAggTradeSchema.safeParse(data);
        if (!result.success) {
          console.error(`[Clusters] ${symbol} invalid aggTrade:`, result.error.message);
          return;
        }
        this.handleTrade(symbol, result.data);
      }
    };
    this.callbacks.set(symbol, callback);
    binanceClient.subscribe(symbol, callback);

    this.startBroadcastInterval(symbol);
  }

  unsubscribe(symbol: SupportedSymbol): void {
    console.log(`[Clusters] Unsubscribing from ${symbol}...`);

    const interval = this.broadcastIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.broadcastIntervals.delete(symbol);
    }

    // Properly unsubscribe callback from binanceClient
    const callback = this.callbacks.get(symbol);
    if (callback) {
      binanceClient.unsubscribe(symbol, callback);
      this.callbacks.delete(symbol);
    }

    this.clusters.delete(symbol);
  }

  /**
   */
  getResyncV2(symbol: SupportedSymbol): ClustersResyncV2 | null {
    const state = this.clusters.get(symbol);
    if (!state || !state.boundsInitialized) return null;

    const columns: Array<{ openTime: number; cells: Record<string, ClusterCell> }> = [];

    const sortedTimes = Array.from(state.columns.keys()).sort((a, b) => a - b);

    for (const openTime of sortedTimes) {
      const cells = state.columns.get(openTime)!;
      const cellsObj: Record<string, ClusterCell> = {};

      for (const [price, cell] of cells) {
        cellsObj[price] = cell; // WITHOUT viewport filter!
      }

      columns.push({ openTime, cells: cellsObj });
    }

    return {
      symbol,
      interval: 5,
      tickSize: state.tickSize.toString(),
      pricePrecision: state.pricePrecision,
      revision: state.serverRevision,
      columns,
      timestamp: Date.now(),
    };
  }

  private initBounds(state: ClusterState, bounds: PriceGridBounds): void {
    state.minPrice = new Decimal(bounds.minPrice);
    state.maxPrice = new Decimal(bounds.maxPrice);
    state.tickSize = new Decimal(bounds.tickSize);
    state.pricePrecision = bounds.pricePrecision;
    state.boundsInitialized = true;
    state.serverRevision = 1;

    console.log(`[Clusters] ${state.symbol} bounds initialized: ${bounds.minPrice} - ${bounds.maxPrice}`);
  }

  private handleBoundsChange(symbol: SupportedSymbol, bounds: PriceGridBounds): void {
    const state = this.clusters.get(symbol);
    if (!state) return;

    const newMin = new Decimal(bounds.minPrice);
    const newMax = new Decimal(bounds.maxPrice);

    let changed = false;

    if (!state.boundsInitialized) {
      this.initBounds(state, bounds);
      return;
    }

    if (newMin.lt(state.minPrice)) {
      state.minPrice = newMin;
      changed = true;
    }

    if (newMax.gt(state.maxPrice)) {
      state.maxPrice = newMax;
      changed = true;
    }

    if (changed) {
      state.serverRevision++;
      console.log(`[Clusters] ${symbol} bounds updated from OrderBook: ${state.minPrice} - ${state.maxPrice}`);
    }
  }

  private expandBoundsIfNeeded(state: ClusterState, price: Decimal): boolean {
    if (!state.boundsInitialized) return false;

    let expanded = false;

    if (price.gt(state.maxPrice)) {
      state.maxPrice = price.plus(state.tickSize.times(EXPAND_TICKS));
      console.log(`[Clusters] ${state.symbol} self-expanded UP to ${state.maxPrice}`);
      expanded = true;
    }

    if (price.lt(state.minPrice)) {
      state.minPrice = price.minus(state.tickSize.times(EXPAND_TICKS));
      console.log(`[Clusters] ${state.symbol} self-expanded DOWN to ${state.minPrice}`);
      expanded = true;
    }

    if (expanded) {
      state.serverRevision++;
    }

    return expanded;
  }

  private getOpenTime(timestamp: number): number {
    return Math.floor(timestamp / CLUSTER_INTERVAL_MS) * CLUSTER_INTERVAL_MS;
  }

  private handleTrade(symbol: SupportedSymbol, data: BinanceAggTrade): void {
    const state = this.clusters.get(symbol);
    if (!state) return;

    if (!state.boundsInitialized) {
      return;
    }

    const tradeTime = data.T; // Trade time from Binance
    const rawPrice = data.p;
    const quantity = parseFloat(data.q);
    const isSell = data.m; // m = true means buyer is maker (sell)

    const priceDecimal = new Decimal(rawPrice);

    const roundedPrice = priceDecimal.div(state.tickSize).round().times(state.tickSize);
    const price = roundedPrice.toFixed(state.pricePrecision);

    this.expandBoundsIfNeeded(state, roundedPrice);

    const tradeOpenTime = this.getOpenTime(tradeTime);

    if (tradeOpenTime !== state.currentOpenTime) {
      this.rotateColumns(state, tradeOpenTime);
    }

    const column = state.columns.get(state.currentOpenTime);
    if (!column) return;

    let cell = column.get(price);
    if (!cell) {
      cell = {
        price,
        buyVolume: '0',
        sellVolume: '0',
      };
      column.set(price, cell);
    }

    if (isSell) {
      cell.sellVolume = (parseFloat(cell.sellVolume) + quantity).toString();
    } else {
      cell.buyVolume = (parseFloat(cell.buyVolume) + quantity).toString();
    }

    state.pendingUpdates.set(price, { ...cell });
  }

  private rotateColumns(state: ClusterState, newOpenTime: number): void {
    const date = new Date(newOpenTime);
    const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    console.log(`[Clusters] ${state.symbol} → new column: ${timeStr}`);

    state.currentOpenTime = newOpenTime;
    state.serverRevision++;

    state.columns.set(newOpenTime, new Map());

    const sortedTimes = Array.from(state.columns.keys()).sort((a, b) => a - b);
    while (sortedTimes.length > MAX_COLUMNS) {
      const oldestTime = sortedTimes.shift()!;
      state.columns.delete(oldestTime);
    }
  }

  private startBroadcastInterval(symbol: SupportedSymbol): void {
    const interval = setInterval(() => {
      this.broadcastDeltasV2(symbol);
    }, BROADCAST_INTERVAL_MS);

    this.broadcastIntervals.set(symbol, interval);
  }

  /**
   */
  private broadcastDeltasV2(symbol: SupportedSymbol): void {
    const state = this.clusters.get(symbol);
    if (!state || state.pendingUpdates.size === 0) return;
    if (!this.broadcastCallback) return;

    const updates: Record<string, ClusterCell> = {};
    for (const [price, cell] of state.pendingUpdates) {
      updates[price] = cell;
    }

    const delta: ClustersDeltaV2 = {
      symbol,
      openTime: state.currentOpenTime,
      revision: state.serverRevision,
      prevRevision: state.lastBroadcastRevisionV2,
      updates,
      timestamp: Date.now(),
    };

    const clients = viewportManager.getClientsForSymbol(symbol);
    for (const client of clients) {
      this.broadcastCallback(client.clientId, {
        type: 'clusters_delta_v2',
        data: delta,
      });
    }

    state.lastBroadcastRevisionV2 = state.serverRevision;
    state.pendingUpdates.clear();
  }

  /**
   */
  cleanup(): void {
    if (this.unsubscribeBounds) {
      this.unsubscribeBounds();
      this.unsubscribeBounds = null;
    }
    this.backgroundSymbols.clear();
  }

}

export const clusterService = new ClusterService();
