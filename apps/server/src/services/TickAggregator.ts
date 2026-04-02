import { binanceClient, type BinanceCallback } from '../binance/client';
import { broadcast } from '../ws/handler';
import type {
  AggregatedTick,
  TradeSide,
  SupportedSymbol,
} from '@sclr/shared';
import {
  TICK_AGGREGATION_INTERVAL_MS,
  BinanceAggTradeSchema,
  type BinanceAggTrade,
} from '@sclr/shared';

interface RawTick {
  price: string;
  quantity: string;
  side: TradeSide;
  timestamp: number;
}

interface AggregationBuffer {
  ticks: Map<string, { quantity: number; count: number; firstTimestamp: number }>;
}

class TickAggregator {
  private buffers = new Map<SupportedSymbol, AggregationBuffer>();
  private intervals = new Map<SupportedSymbol, ReturnType<typeof setInterval>>();
  private callbacks = new Map<SupportedSymbol, BinanceCallback>(); // Store callbacks for proper cleanup

  subscribe(symbol: SupportedSymbol): void {
    if (this.buffers.has(symbol)) return;

    console.log(`[TickAggregator] Subscribing to ${symbol}...`);

    this.buffers.set(symbol, { ticks: new Map() });

    const callback: BinanceCallback = (data) => {
      if (data.e === 'aggTrade') {
        const result = BinanceAggTradeSchema.safeParse(data);
        if (!result.success) {
          console.error(`[TickAggregator] ${symbol} invalid aggTrade:`, result.error.message);
          return;
        }
        this.handleTrade(symbol, result.data);
      }
    };
    this.callbacks.set(symbol, callback);
    binanceClient.subscribe(symbol, callback);

    this.startAggregationInterval(symbol);
  }

  unsubscribe(symbol: SupportedSymbol): void {
    console.log(`[TickAggregator] Unsubscribing from ${symbol}...`);

    const interval = this.intervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(symbol);
    }

    // Properly unsubscribe callback from binanceClient
    const callback = this.callbacks.get(symbol);
    if (callback) {
      binanceClient.unsubscribe(symbol, callback);
      this.callbacks.delete(symbol);
    }

    this.buffers.delete(symbol);
  }

  private handleTrade(symbol: SupportedSymbol, data: BinanceAggTrade): void {
    const buffer = this.buffers.get(symbol);
    if (!buffer) {
      // Buffer was deleted - callback should have been unsubscribed
      return;
    }

    const price = data.p;
    const quantity = parseFloat(data.q);

    if (isNaN(quantity)) {
      console.error(`[TickAggregator] ${symbol} invalid quantity: ${data.q}`);
      return;
    }

    const side: TradeSide = data.m ? 'sell' : 'buy';

    const key = `${price}_${side}`;
    const existing = buffer.ticks.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.count += 1;
    } else {
      buffer.ticks.set(key, {
        quantity,
        count: 1,
        firstTimestamp: data.T,
      });
    }
  }

  private startAggregationInterval(symbol: SupportedSymbol): void {
    const interval = setInterval(() => {
      this.flushBuffer(symbol);
    }, TICK_AGGREGATION_INTERVAL_MS);

    this.intervals.set(symbol, interval);
  }

  private flushBuffer(symbol: SupportedSymbol): void {
    const buffer = this.buffers.get(symbol);
    if (!buffer || buffer.ticks.size === 0) return;

    const aggregatedTicks: AggregatedTick[] = [];
    const now = Date.now();

    const entries = Array.from(buffer.ticks.entries()).sort((a, b) => {
      return a[1].firstTimestamp - b[1].firstTimestamp;
    });

    for (const [key, data] of entries) {
      const [price, side] = key.split('_') as [string, TradeSide];

      aggregatedTicks.push({
        price,
        quantity: data.quantity.toString(),
        side,
        count: data.count,
        timestamp: data.firstTimestamp,
      });
    }

    buffer.ticks.clear();

    if (aggregatedTicks.length > 0) {
      broadcast(symbol, {
        type: 'ticks',
        data: {
          symbol,
          ticks: aggregatedTicks,
          timestamp: now,
        },
      });
    }
  }
}

export const tickAggregator = new TickAggregator();
