import Decimal from 'decimal.js';
import { binanceClient, type BinanceCallback } from '../binance/client';
import { viewportManager } from './ViewportManager';
import { config } from '../config';
import type {
  PriceLevel,
  SupportedSymbol,
  OrderBookSnapshotV2,
  OrderBookDeltaV2,
  OrderBookResyncV2,
} from '@sclr/shared';
import {
  ORDERBOOK_CONFIG,
  ORDERBOOK_CONFIG_V2,
  BinanceDepthUpdateSchema,
  BinanceBookTickerSchema,
  type BinanceDepthUpdate,
  type BinanceBookTicker,
} from '@sclr/shared';

interface SymbolInfo {
  tickSize: string;
  pricePrecision: number;
}

interface OrderBookState {
  symbol: SupportedSymbol;
  tickSize: string;
  pricePrecision: number;

  // Raw Binance data
  rawBids: Map<string, string>;  // price -> qty
  rawAsks: Map<string, string>;  // price -> qty

  // Full order book with empty levels
  levels: Map<string, PriceLevel>;
  minPrice: Decimal;
  maxPrice: Decimal;

  // Best bid/ask from bookTicker (O(1) access)
  bestBidPrice: string;
  bestBidQty: string;
  bestAskPrice: string;
  bestAskQty: string;

  binanceLastUpdateId: number;
  serverRevision: number;

  // Pending changes for broadcast: price -> qty ("0" = deletion)
  pendingBidsV2: Map<string, string>;
  pendingAsksV2: Map<string, string>;
  lastBroadcastRevisionV2: number;

  // Sync state
  pendingDeltas: BinanceDepthUpdate[];
  isReady: boolean;
  isResyncing: boolean; // Prevents parallel resync
  waitingForFirstValidUpdate: boolean; // After snapshot, wait for first valid Binance update
}

export interface PriceGridBounds {
  minPrice: string;
  maxPrice: string;
  tickSize: string;
  pricePrecision: number;
}

export type BoundsChangeCallback = (symbol: SupportedSymbol, bounds: PriceGridBounds) => void;

class OrderBookService {
  private orderbooks = new Map<SupportedSymbol, OrderBookState>();
  private symbolInfoCache = new Map<SupportedSymbol, SymbolInfo>();
  private broadcastIntervals = new Map<SupportedSymbol, ReturnType<typeof setInterval>>();
  private callbacks = new Map<SupportedSymbol, BinanceCallback>(); // Store callbacks for proper cleanup

  // Promise-based semaphore to prevent concurrent resyncs
  private resyncPromises = new Map<SupportedSymbol, Promise<void>>();

  // Resolves race condition: handler.ts may call subscribe() while initial subscribe() is still running
  private readyResolvers = new Map<SupportedSymbol, { promise: Promise<void>; resolve: () => void }>();

  // Track resync retry timeouts for cleanup on unsubscribe
  private resyncTimeouts = new Map<SupportedSymbol, ReturnType<typeof setTimeout>>();

  private broadcastCallback: ((clientId: string, message: any) => void) | null = null;

  // Notify ClusterService when price bounds change
  private boundsChangeCallbacks: BoundsChangeCallback[] = [];

  setBroadcastCallback(callback: (clientId: string, message: any) => void) {
    this.broadcastCallback = callback;
  }

  onBoundsChange(callback: BoundsChangeCallback): () => void {
    this.boundsChangeCallbacks.push(callback);
    return () => {
      this.boundsChangeCallbacks = this.boundsChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Preload exchangeInfo for all symbols in one request.
   * Call once at startup BEFORE subscribing. Retries up to 5 times with exponential backoff.
   */
  async preloadSymbolInfo(symbols: SupportedSymbol[]): Promise<boolean> {
    console.log(`[OrderBook] Preloading exchange info for ${symbols.length} symbols...`);

    const MAX_RETRIES = 5;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      const result = await binanceClient.getExchangeInfo();

      if (!result.success) {
        const delay = Math.min(5000 * Math.pow(2, attempt - 1), 60000); // 5s, 10s, 20s, 40s, 60s
        console.error(`[OrderBook] Preload attempt ${attempt}/${MAX_RETRIES} failed: ${result.error}. Retry in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      const exchangeInfo = result.data;
      let loaded = 0;

      for (const symbol of symbols) {
        const symbolData = exchangeInfo.symbols?.find((s: any) => s.symbol === symbol);
        if (!symbolData) continue;

        const priceFilter = symbolData.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        if (!priceFilter?.tickSize || symbolData.pricePrecision === undefined) continue;

        this.symbolInfoCache.set(symbol, {
          tickSize: priceFilter.tickSize,
          pricePrecision: symbolData.pricePrecision,
        });
        loaded++;
      }

      console.log(`[OrderBook] Preloaded exchange info for ${loaded}/${symbols.length} symbols`);
      return true;
    }

    console.error(`[OrderBook] Failed to preload after ${MAX_RETRIES} attempts. Will try per-symbol loading.`);
    return false;
  }

  private notifyBoundsChange(symbol: SupportedSymbol): void {
    const bounds = this.getBounds(symbol);
    if (!bounds) return;

    for (const callback of this.boundsChangeCallbacks) {
      callback(symbol, bounds);
    }
  }

  getBounds(symbol: SupportedSymbol): PriceGridBounds | null {
    const state = this.orderbooks.get(symbol);
    if (!state || !state.isReady) return null;

    return {
      minPrice: state.minPrice.toFixed(state.pricePrecision),
      maxPrice: state.maxPrice.toFixed(state.pricePrecision),
      tickSize: state.tickSize,
      pricePrecision: state.pricePrecision,
    };
  }

  async subscribe(symbol: SupportedSymbol): Promise<void> {
    if (this.orderbooks.has(symbol)) {
      // Already subscribed but may not be ready yet - wait
      const existing = this.readyResolvers.get(symbol);
      if (existing) {
        console.log(`[OrderBook] ${symbol} subscribe() called while initializing, waiting for ready...`);
        await existing.promise;
      }
      return;
    }

    console.log(`[OrderBook] Subscribing to ${symbol}...`);

    // Create readyResolver before state init
    let resolveReady!: () => void;
    const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
    this.readyResolvers.set(symbol, { promise: readyPromise, resolve: resolveReady });

    const symbolInfo = await this.getSymbolInfo(symbol);

    const state: OrderBookState = {
      symbol,
      tickSize: symbolInfo.tickSize,
      pricePrecision: symbolInfo.pricePrecision,
      rawBids: new Map(),
      rawAsks: new Map(),
      levels: new Map(),
      minPrice: new Decimal(0),
      maxPrice: new Decimal(0),
      bestBidPrice: '0',
      bestBidQty: '0',
      bestAskPrice: '0',
      bestAskQty: '0',
      binanceLastUpdateId: 0,
      serverRevision: 0,
      pendingBidsV2: new Map(),
      pendingAsksV2: new Map(),
      lastBroadcastRevisionV2: 0,
      pendingDeltas: [],
      isReady: false,
      isResyncing: false,
      waitingForFirstValidUpdate: true,
    };

    this.orderbooks.set(symbol, state);

    // 1. Subscribe to WebSocket (events buffer into pendingDeltas)
    const callback: BinanceCallback = (data) => {
      if (data.e === 'depthUpdate') {
        const result = BinanceDepthUpdateSchema.safeParse(data);
        if (!result.success) {
          console.error(`[OrderBook] ${symbol} invalid depthUpdate:`, result.error.message);
          return;
        }
        this.handleDepthUpdate(symbol, result.data);
      } else if (data.e === 'bookTicker') {
        const result = BinanceBookTickerSchema.safeParse(data);
        if (!result.success) {
          console.error(`[OrderBook] ${symbol} invalid bookTicker:`, result.error.message);
          return;
        }
        this.handleBookTicker(symbol, result.data);
      }
    };
    this.callbacks.set(symbol, callback);
    binanceClient.subscribe(symbol, callback);

    // 2. Wait for WS events to accumulate
    await this.sleep(500);

    await this.fetchSnapshot(symbol);

    // 4. Start broadcast interval
    this.startBroadcastInterval(symbol);

    // Signal readiness for waiting subscribe() calls
    const resolver = this.readyResolvers.get(symbol);
    if (resolver) {
      resolver.resolve();
      this.readyResolvers.delete(symbol);
    }

    console.log(`[OrderBook] ${symbol} ready. Levels: ${state.levels.size}`);
  }

  unsubscribe(symbol: SupportedSymbol): void {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    console.log(`[OrderBook] Unsubscribing from ${symbol}...`);

    const interval = this.broadcastIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.broadcastIntervals.delete(symbol);
    }

    // Cancel pending resync timeout
    const resyncTimeout = this.resyncTimeouts.get(symbol);
    if (resyncTimeout) {
      clearTimeout(resyncTimeout);
      this.resyncTimeouts.delete(symbol);
    }

    // Properly unsubscribe callback from binanceClient
    const callback = this.callbacks.get(symbol);
    if (callback) {
      binanceClient.unsubscribe(symbol, callback);
      this.callbacks.delete(symbol);
    }

    // Clean up readyResolver if unsubscribed before ready
    const resolver = this.readyResolvers.get(symbol);
    if (resolver) {
      resolver.resolve(); // Unblock waiting callers
      this.readyResolvers.delete(symbol);
    }

    this.orderbooks.delete(symbol);
  }

  private async getSymbolInfo(symbol: SupportedSymbol): Promise<SymbolInfo> {
    const cached = this.symbolInfoCache.get(symbol);
    if (cached) return cached;

    const result = await binanceClient.getExchangeInfo();

    if (!result.success) {
      throw new Error(`Failed to get exchange info: ${result.error}`);
    }

    const exchangeInfo = result.data;

    // Binance returns all symbols - find the one we need
    const symbolData = exchangeInfo.symbols?.find(
      (s: any) => s.symbol === symbol
    );

    if (!symbolData) {
      throw new Error(`Symbol ${symbol} not found in exchange info`);
    }

    const priceFilter = symbolData.filters?.find(
      (f: any) => f.filterType === 'PRICE_FILTER'
    );

    if (!priceFilter?.tickSize) {
      throw new Error(`Symbol ${symbol} missing tickSize in PRICE_FILTER`);
    }
    if (symbolData.pricePrecision === undefined) {
      throw new Error(`Symbol ${symbol} missing pricePrecision`);
    }

    const tickSize = priceFilter.tickSize;
    const pricePrecision = symbolData.pricePrecision;

    const info: SymbolInfo = { tickSize, pricePrecision };
    this.symbolInfoCache.set(symbol, info);

    console.log(`[OrderBook] ${symbol} tickSize=${tickSize}, precision=${pricePrecision}`);

    return info;
  }

  private async fetchSnapshot(symbol: SupportedSymbol): Promise<void> {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    console.log(`[OrderBook] Fetching snapshot for ${symbol}...`);

    // limit=100 costs 10 weight instead of 50 for limit=1000
    const result = await binanceClient.getDepthSnapshot(symbol, 100);

    if (!result.success) {
      throw new Error(`Failed to fetch snapshot for ${symbol}: ${result.error}`);
    }

    const snapshot = result.data;

    // Populate raw data from snapshot
    state.rawBids.clear();
    state.rawAsks.clear();

    for (const [price, qty] of snapshot.bids) {
      if (parseFloat(qty) > 0) {
        state.rawBids.set(price, qty);
      }
    }

    for (const [price, qty] of snapshot.asks) {
      if (parseFloat(qty) > 0) {
        state.rawAsks.set(price, qty);
      }
    }

    state.binanceLastUpdateId = snapshot.lastUpdateId;

    // Apply buffered deltas
    this.applyPendingDeltas(symbol);

    // Build full level map with empty levels
    this.buildFullMap(symbol);

    state.isReady = true;
    state.serverRevision = 1;

    console.log(`[OrderBook] ${symbol} snapshot loaded. Range: ${state.minPrice} - ${state.maxPrice}`);
  }

  private handleDepthUpdate(symbol: SupportedSymbol, data: BinanceDepthUpdate): void {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    // Buffer events until snapshot is loaded
    if (!state.isReady) {
      // Limit pending deltas to prevent memory leak
      const MAX_PENDING_DELTAS = 1000;
      if (state.pendingDeltas.length >= MAX_PENDING_DELTAS) {
        // Remove oldest 100 deltas to make room
        state.pendingDeltas = state.pendingDeltas.slice(-900);
        console.warn(`[OrderBook] ${symbol} pendingDeltas overflow, trimmed to 900`);
      }
      state.pendingDeltas.push(data);
      return;
    }

    if (data.u <= state.binanceLastUpdateId) {
      return; // Stale update
    }

    // After snapshot/resync, wait for first valid update per Binance Futures API:
    // U <= lastUpdateId <= u (U = first update ID, u = final update ID)
    if (state.waitingForFirstValidUpdate) {
      const lastId = state.binanceLastUpdateId;

      if (data.U <= lastId && data.u >= lastId) {
        // First valid update found
        console.log(`[OrderBook] ${symbol} first valid update found: U=${data.U}, u=${data.u}, lastId=${lastId}`);
        state.waitingForFirstValidUpdate = false;
        this.applyDelta(state, data.b, data.a);
        state.binanceLastUpdateId = data.u;
        this.updateBestBidAskIncremental(state, data.b, data.a);
        state.serverRevision++;
        return;
      } else if (data.u < lastId) {
        // Stale update, skip silently
        return;
      } else {
        // U > lastId - missed the valid update, need resync
        console.error(`[OrderBook] ${symbol} missed first valid update! U=${data.U} > lastId=${lastId}. Resyncing...`);
        this.resyncFromBinance(symbol);
        return;
      }
    }

    // Continuity check: pu must equal our lastUpdateId
    if (data.pu !== state.binanceLastUpdateId) {
      console.error(`[OrderBook] ${symbol} GAP detected! pu=${data.pu}, expected=${state.binanceLastUpdateId}, diff=${data.pu - state.binanceLastUpdateId}`);
      this.resyncFromBinance(symbol);
      return;
    }

    this.applyDelta(state, data.b, data.a);
    state.binanceLastUpdateId = data.u;

    // Incremental best bid/ask update - O(1) in most cases
    this.updateBestBidAskIncremental(state, data.b, data.a);

    state.serverRevision++;
  }

  // bookTicker handler - kept as fallback, primary source is computeBestBidAsk()
  private handleBookTicker(symbol: SupportedSymbol, data: BinanceBookTicker): void {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    // Only store qty from bookTicker; bestBidPrice/bestAskPrice are computed from rawBids/rawAsks
    state.bestBidQty = data.B;
    state.bestAskQty = data.A;
  }

  /** Full scan for bestBid/bestAsk. Used only on snapshot/resync, NOT per delta. */
  private computeBestBidAskFull(state: OrderBookState): void {
    const bestBid = this.findMax(state.rawBids.keys());

    const bestAsk = this.findMin(state.rawAsks.keys());

    if (bestBid) {
      state.bestBidPrice = bestBid;
    }
    if (bestAsk) {
      state.bestAskPrice = bestAsk;
    }
  }

  /**
   * Incremental bestBid/bestAsk update after delta.
   * O(1) normally, O(n) only when current best price is removed.
   */
  private updateBestBidAskIncremental(
    state: OrderBookState,
    bids: [string, string][],
    asks: [string, string][]
  ): void {
    let needFullBidScan = false;
    let needFullAskScan = false;

    for (const [price, qty] of bids) {
      const priceNum = parseFloat(price);
      const currentBest = parseFloat(state.bestBidPrice);

      if (qty === '0' || parseFloat(qty) === 0) {
        // If best bid was removed, need full scan
        if (priceNum >= currentBest - 1e-10) {
          needFullBidScan = true;
        }
      } else {
        // New price higher than current best
        if (priceNum > currentBest + 1e-10) {
          state.bestBidPrice = price;
        }
      }
    }

    for (const [price, qty] of asks) {
      const priceNum = parseFloat(price);
      const currentBest = parseFloat(state.bestAskPrice);

      if (qty === '0' || parseFloat(qty) === 0) {
        // If best ask was removed, need full scan
        if (priceNum <= currentBest + 1e-10) {
          needFullAskScan = true;
        }
      } else {
        // New price lower than current best
        if (currentBest === 0 || priceNum < currentBest - 1e-10) {
          state.bestAskPrice = price;
        }
      }
    }

    // O(n) scan only if current best was removed
    if (needFullBidScan) {
      const newBestBid = this.findMax(state.rawBids.keys());
      if (newBestBid) {
        state.bestBidPrice = newBestBid;
      }
    }

    if (needFullAskScan) {
      const newBestAsk = this.findMin(state.rawAsks.keys());
      if (newBestAsk) {
        state.bestAskPrice = newBestAsk;
      }
    }
  }

  private applyPendingDeltas(symbol: SupportedSymbol): void {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    // Sort by u (final update ID)
    state.pendingDeltas.sort((a, b) => a.u - b.u);

    let foundFirstValid = false;

    for (const delta of state.pendingDeltas) {
      // Skip stale updates
      if (delta.u <= state.binanceLastUpdateId) continue;

      if (!foundFirstValid) {
        // Per Binance Futures API: first valid delta must have U <= lastUpdateId <= u
        const lastId = state.binanceLastUpdateId;
        if (delta.U <= lastId && delta.u >= lastId) {
          console.log(`[OrderBook] ${symbol} pending: first valid delta U=${delta.U}, u=${delta.u}, lastId=${lastId}`);
          this.applyDeltaToRaw(state, delta.b, delta.a);
          state.binanceLastUpdateId = delta.u;
          foundFirstValid = true;
        }
        // Skip if U > lastId (haven't reached the valid delta yet)
      } else {
        // Subsequent deltas: pu must equal our lastUpdateId
        if (delta.pu === state.binanceLastUpdateId) {
          this.applyDeltaToRaw(state, delta.b, delta.a);
          state.binanceLastUpdateId = delta.u;
        }
        // If gap, stop - live handler will detect and resync
      }
    }

    // If pending deltas were applied, no longer waiting for first valid update
    if (foundFirstValid) {
      state.waitingForFirstValidUpdate = false;
      console.log(`[OrderBook] ${symbol} pending deltas applied, waitingForFirstValidUpdate=false`);
    }

    state.pendingDeltas = [];
  }

  private applyDeltaToRaw(
    state: OrderBookState,
    bids: [string, string][],
    asks: [string, string][]
  ): void {
    for (const [price, qty] of bids) {
      if (qty === '0' || parseFloat(qty) === 0) {
        state.rawBids.delete(price);
        state.pendingBidsV2.set(price, '0');
      } else {
        state.rawBids.set(price, qty);
        state.pendingBidsV2.set(price, qty);
      }
    }

    for (const [price, qty] of asks) {
      if (qty === '0' || parseFloat(qty) === 0) {
        state.rawAsks.delete(price);
        state.pendingAsksV2.set(price, '0');
      } else {
        state.rawAsks.set(price, qty);
        state.pendingAsksV2.set(price, qty);
      }
    }
  }

  private applyDelta(
    state: OrderBookState,
    bids: [string, string][],
    asks: [string, string][]
  ): void {
    this.applyDeltaToRaw(state, bids, asks);

    for (const [price, qty] of bids) {
      this.updateLevel(state, price, qty, 'bid');
    }

    for (const [price, qty] of asks) {
      this.updateLevel(state, price, qty, 'ask');
    }
  }

  private updateLevel(
    state: OrderBookState,
    price: string,
    qty: string,
    side: 'bid' | 'ask'
  ): void {
    const level = state.levels.get(price);

    if (level) {
      const oldSide = level.side;
      const oldQty = level.quantity;

      if (qty === '0' || parseFloat(qty) === 0) {
        // qty=0 means removal from THIS side; check if other side has data
        const otherSide: 'bid' | 'ask' = side === 'bid' ? 'ask' : 'bid';
        const otherRaw = side === 'bid' ? state.rawAsks : state.rawBids;

        if (otherRaw.has(price)) {
          // Other side has data - switch to it
          level.quantity = otherRaw.get(price)!;
          level.side = otherSide;
        } else {
          // No data on either side
          level.quantity = '0';
          level.side = 'empty';
        }
      } else {
        level.quantity = qty;
        level.side = side;
      }
    } else {
      // Level not in range - expand
      this.expandRange(state, price, qty, side);
    }
  }

  private buildFullMap(symbol: SupportedSymbol): void {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    const tickSize = new Decimal(state.tickSize);

    const bestBid = this.findMax(state.rawBids.keys());
    const bestAsk = this.findMin(state.rawAsks.keys());

    if (!bestBid || !bestAsk) {
      console.error(`[OrderBook] ${symbol} no best bid/ask found`);
      return;
    }

    // Compute mid-price and bounds (+-1%)
    const midPrice = new Decimal(bestBid).plus(bestAsk).div(2);
    const range = midPrice.times(ORDERBOOK_CONFIG.INITIAL_RANGE_PERCENT);

    state.minPrice = this.roundToTick(midPrice.minus(range), tickSize, 'down');
    state.maxPrice = this.roundToTick(midPrice.plus(range), tickSize, 'up');

    // Build full level map
    state.levels.clear();

    for (let price = state.minPrice;
         price.lte(state.maxPrice);
         price = price.plus(tickSize)) {

      const priceStr = price.toFixed(state.pricePrecision);

      if (state.rawBids.has(priceStr)) {
        state.levels.set(priceStr, {
          price: priceStr,
          quantity: state.rawBids.get(priceStr)!,
          side: 'bid',
        });
      } else if (state.rawAsks.has(priceStr)) {
        state.levels.set(priceStr, {
          price: priceStr,
          quantity: state.rawAsks.get(priceStr)!,
          side: 'ask',
        });
      } else {
        state.levels.set(priceStr, {
          price: priceStr,
          quantity: '0',
          side: 'empty',
        });
      }
    }

    console.log(`[OrderBook] ${symbol} built full map: ${state.levels.size} levels`);

    // Full recompute of best bid/ask on snapshot
    this.computeBestBidAskFull(state);

    // Notify bounds change listeners
    this.notifyBoundsChange(symbol);
  }

  private expandRange(
    state: OrderBookState,
    price: string,
    qty: string,
    side: 'bid' | 'ask'
  ): void {
    const priceDecimal = new Decimal(price);
    const tickSize = new Decimal(state.tickSize);
    const expandTicks = ORDERBOOK_CONFIG.EXPAND_TICKS;

    // Sanity check: don't expand if price is >10% away from mid
    const midPrice = state.minPrice.plus(state.maxPrice).div(2);
    const maxDeviation = midPrice.times(0.1); // 10%

    if (priceDecimal.lt(midPrice.minus(maxDeviation)) || priceDecimal.gt(midPrice.plus(maxDeviation))) {
      // Spam log removed: ~800 msgs/min generated 3.8 GB logs in 11 days
      return;
    }

    if (priceDecimal.gt(state.maxPrice)) {
      // Expand UP
      const newMax = priceDecimal.plus(tickSize.times(expandTicks));

      for (let p = state.maxPrice.plus(tickSize);
           p.lte(newMax);
           p = p.plus(tickSize)) {

        const pStr = p.toFixed(state.pricePrecision);
        if (!state.levels.has(pStr)) {
          const level: PriceLevel = {
            price: pStr,
            quantity: '0',
            side: 'empty',
          };
          state.levels.set(pStr, level);
        }
      }

      state.maxPrice = newMax;
      console.log(`[OrderBook] ${state.symbol} expanded UP to ${newMax}`);
      this.notifyBoundsChange(state.symbol);

    } else if (priceDecimal.lt(state.minPrice)) {
      // Expand DOWN
      const newMin = priceDecimal.minus(tickSize.times(expandTicks));

      for (let p = state.minPrice.minus(tickSize);
           p.gte(newMin);
           p = p.minus(tickSize)) {

        const pStr = p.toFixed(state.pricePrecision);
        if (!state.levels.has(pStr)) {
          const level: PriceLevel = {
            price: pStr,
            quantity: '0',
            side: 'empty',
          };
          state.levels.set(pStr, level);
        }
      }

      state.minPrice = newMin;
      console.log(`[OrderBook] ${state.symbol} expanded DOWN to ${newMin}`);
      this.notifyBoundsChange(state.symbol);
    }

    // Add the level itself
    const level: PriceLevel = {
      price,
      quantity: qty === '0' ? '0' : qty,
      side: qty === '0' ? 'empty' : side,
    };
    state.levels.set(price, level);
  }

  private async resyncFromBinance(symbol: SupportedSymbol): Promise<void> {
    const state = this.orderbooks.get(symbol);
    if (!state) return;

    const existingPromise = this.resyncPromises.get(symbol);
    if (existingPromise) {
      console.log(`[OrderBook] ${symbol} resync already in progress, waiting...`);
      await existingPromise;
      return;
    }

    console.log(`[OrderBook] ${symbol} resyncing from Binance...`);

    // Create promise and resolver for current resync
    let resolveResync!: () => void;
    const resyncPromise = new Promise<void>((resolve) => {
      resolveResync = resolve;
    });
    this.resyncPromises.set(symbol, resyncPromise);

    state.isResyncing = true;
    state.pendingDeltas = [];
    state.waitingForFirstValidUpdate = true;

    // Save previous isReady state for recovery on failure
    const wasReady = state.isReady;
    state.isReady = false;

    try {
      await this.fetchSnapshot(symbol);
      state.serverRevision++;
      state.isReady = true;
      // Send resync to all subscribed clients
      this.forceResyncClientsV2(symbol, 'binance_gap');
    } catch (error) {
      console.error(`[OrderBook] ${symbol} resync failed:`, error);
      // Restore isReady to avoid losing data entirely
      state.isReady = wasReady;
      state.waitingForFirstValidUpdate = false; // Reset to avoid getting stuck

      // Cancel previous retry timeout if any
      const existingTimeout = this.resyncTimeouts.get(symbol);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Retry after 15s (longer delay to reduce rate limit pressure)
      const timeout = setTimeout(() => {
        this.resyncTimeouts.delete(symbol);
        console.log(`[OrderBook] ${symbol} retry resync after failure...`);
        this.resyncFromBinance(symbol);
      }, 15000);
      this.resyncTimeouts.set(symbol, timeout);
    } finally {
      state.isResyncing = false;
      this.resyncPromises.delete(symbol);
      resolveResync();
    }
  }

  private startBroadcastInterval(symbol: SupportedSymbol): void {
    const interval = setInterval(() => {
      this.broadcastDeltasV2(symbol);
    }, ORDERBOOK_CONFIG.DELTA_BROADCAST_INTERVAL_MS);

    this.broadcastIntervals.set(symbol, interval);
  }

  /** V2 Snapshot - metadata only, no levels. Client generates skeleton from midPrice + tickSize. */
  getSnapshotV2(symbol: SupportedSymbol): OrderBookSnapshotV2 | null {
    const state = this.orderbooks.get(symbol);
    if (!state || !state.isReady) return null;

    return {
      symbol,
      revision: state.serverRevision,
      midPrice: this.getMidPrice(symbol),
      bestBid: state.bestBidPrice,
      bestAsk: state.bestAskPrice,
      tickSize: state.tickSize,
      pricePrecision: state.pricePrecision,
      timestamp: Date.now(),
    };
  }

  /** V2 Resync - metadata + full bids/asks. */
  getResyncV2(symbol: SupportedSymbol, reason: 'binance_gap' | 'server_restart' | 'client_request'): OrderBookResyncV2 | null {
    const state = this.orderbooks.get(symbol);
    if (!state || !state.isReady) return null;

    const bids: [string, string][] = Array.from(state.rawBids.entries());
    const asks: [string, string][] = Array.from(state.rawAsks.entries());

    // Update lastBroadcastRevisionV2 - next delta will use this as prevRevision
    state.lastBroadcastRevisionV2 = state.serverRevision;

    return {
      symbol,
      revision: state.serverRevision,
      reason,
      midPrice: this.getMidPrice(symbol),
      bestBid: state.bestBidPrice,
      bestAsk: state.bestAskPrice,
      tickSize: state.tickSize,
      pricePrecision: state.pricePrecision,
      bids,
      asks,
      timestamp: Date.now(),
    };
  }

  /**
   */
  private broadcastDeltasV2(symbol: SupportedSymbol): void {
    const state = this.orderbooks.get(symbol);
    if (!state || !state.isReady) return;
    if (state.pendingBidsV2.size === 0 && state.pendingAsksV2.size === 0) return;
    if (!this.broadcastCallback) return;

    const bids: [string, string][] = Array.from(state.pendingBidsV2.entries());
    const asks: [string, string][] = Array.from(state.pendingAsksV2.entries());

    const clients = viewportManager.getClientsForSymbol(symbol);

    const message = {
      type: 'orderbook_delta_v2',
      data: {
        symbol,
        revision: state.serverRevision,
        prevRevision: state.lastBroadcastRevisionV2,  // Use last broadcast revision
        bids,
        asks,
        bestBid: state.bestBidPrice,
        bestAsk: state.bestAskPrice,
        timestamp: Date.now(),
      } as OrderBookDeltaV2,
    };

    for (const client of clients) {
      this.broadcastCallback(client.clientId, message);
      viewportManager.updateOrderBookRevision(client.clientId, symbol, state.serverRevision);
    }

    state.lastBroadcastRevisionV2 = state.serverRevision;
    state.pendingBidsV2.clear();
    state.pendingAsksV2.clear();
  }

  /**
   */
  private forceResyncClientsV2(symbol: SupportedSymbol, reason: 'binance_gap' | 'server_restart'): void {
    const resync = this.getResyncV2(symbol, reason);
    if (!resync || !this.broadcastCallback) return;

    const clients = viewportManager.getClientsForSymbol(symbol);
    console.log(`[OrderBook] Sending V2 resync to ${clients.length} clients for ${symbol}`);

    const message = {
      type: 'orderbook_resync_v2',
      data: resync,
    };

    for (const client of clients) {
      this.broadcastCallback(client.clientId, message);
      viewportManager.updateOrderBookRevision(client.clientId, symbol, resync.revision);
    }
  }

  getMidPrice(symbol: SupportedSymbol): string {
    const state = this.orderbooks.get(symbol);
    if (!state) return '0';

    let bestBid: string | null = state.bestBidPrice;
    let bestAsk: string | null = state.bestAskPrice;

    if (!bestBid || bestBid === '0' || !bestAsk || bestAsk === '0') {
      bestBid = this.findMax(state.rawBids.keys());
      bestAsk = this.findMin(state.rawAsks.keys());
      if (!bestBid || !bestAsk) return '0';
    }

    const tickSize = new Decimal(state.tickSize);
    const midPrice = new Decimal(bestBid).plus(bestAsk).div(2);
    const rounded = midPrice.div(tickSize).round().times(tickSize);

    return rounded.toFixed(state.pricePrecision);
  }

  getBestBidAsk(symbol: SupportedSymbol): { bestBid: string; bestAsk: string } | null {
    const state = this.orderbooks.get(symbol);
    if (!state || state.bestBidPrice === '0') return null;

    return {
      bestBid: state.bestBidPrice,
      bestAsk: state.bestAskPrice,
    };
  }

  getState(symbol: SupportedSymbol): OrderBookState | undefined {
    return this.orderbooks.get(symbol);
  }

  isReady(symbol: SupportedSymbol): boolean {
    return this.orderbooks.get(symbol)?.isReady ?? false;
  }

  /**
   */
  getSymbolInfoFromCache(symbol: SupportedSymbol): SymbolInfo | undefined {
    return this.symbolInfoCache.get(symbol);
  }

  private findMax(keys: IterableIterator<string>): string | null {
    let max: string | null = null;
    let maxVal = new Decimal(0);

    for (const key of keys) {
      const val = new Decimal(key);
      if (val.gt(maxVal)) {
        maxVal = val;
        max = key;
      }
    }

    return max;
  }

  private findMin(keys: IterableIterator<string>): string | null {
    let min: string | null = null;
    let minVal = new Decimal(Infinity);

    for (const key of keys) {
      const val = new Decimal(key);
      if (val.lt(minVal)) {
        minVal = val;
        min = key;
      }
    }

    return min;
  }

  private roundToTick(value: Decimal, tickSize: Decimal, direction: 'up' | 'down'): Decimal {
    if (direction === 'down') {
      return value.div(tickSize).floor().times(tickSize);
    } else {
      return value.div(tickSize).ceil().times(tickSize);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const orderBookService = new OrderBookService();
