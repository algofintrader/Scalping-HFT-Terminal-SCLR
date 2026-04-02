import type { SupportedSymbol } from '@sclr/shared';
import { config } from '../config';

// Result types for error handling
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export interface DepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface SymbolTicker {
  symbol: string;
  quoteVolume: string; // 24h volume in USDT
  priceChangePercent: string;
  lastPrice: string;   // Last price
  count: string;       // Number of trades in 24h
}

interface BinanceDepthUpdate {
  e: 'depthUpdate';
  E: number; // Event time
  T: number; // Transaction time
  s: string; // Symbol
  U: number; // First update ID
  u: number; // Final update ID
  pu: number; // Previous final update ID
  b: [string, string][]; // Bids [price, qty]
  a: [string, string][]; // Asks [price, qty]
}

interface BinanceAggTrade {
  e: 'aggTrade';
  E: number; // Event time
  s: string; // Symbol
  a: number; // Aggregate trade ID
  p: string; // Price
  q: string; // Quantity
  f: number; // First trade ID
  l: number; // Last trade ID
  T: number; // Trade time
  m: boolean; // Is buyer maker
}

interface BinanceBookTicker {
  e: 'bookTicker';
  u: number; // Order book updateId
  s: string; // Symbol
  b: string; // Best bid price
  B: string; // Best bid qty
  a: string; // Best ask price
  A: string; // Best ask qty
  T: number; // Transaction time
  E: number; // Event time
}

export type BinanceCallback = (data: BinanceDepthUpdate | BinanceAggTrade | BinanceBookTicker) => void;

class BinanceClient {
  private connections = new Map<string, WebSocket>();
  private callbacks = new Map<string, Set<BinanceCallback>>();
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  private lastRestRequestTime = 0;
  private readonly REST_MIN_INTERVAL_MS = 300;
  private restRequestQueue: Array<() => void> = [];
  private isProcessingQueue = false;

  private async throttledRest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        const now = Date.now();
        const elapsed = now - this.lastRestRequestTime;
        const waitTime = Math.max(0, this.REST_MIN_INTERVAL_MS - elapsed);

        if (waitTime > 0) {
          await new Promise(r => setTimeout(r, waitTime));
        }

        this.lastRestRequestTime = Date.now();

        try {
          const result = await requestFn();
          resolve(result);
        } catch (err) {
          reject(err);
        }

        this.processQueue();
      };

      this.restRequestQueue.push(execute);

      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  private processQueue() {
    if (this.restRequestQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    this.isProcessingQueue = true;
    const next = this.restRequestQueue.shift();
    if (next) {
      // FIXED: Await async function and catch errors to prevent unhandled rejections
      Promise.resolve(next()).catch((err) => {
        console.error('[Binance] REST queue execution error:', err);
      });
    }
  }

  subscribe(symbol: SupportedSymbol, callback: BinanceCallback) {
    const key = symbol.toLowerCase();

    if (!this.callbacks.has(key)) {
      this.callbacks.set(key, new Set());
    }
    this.callbacks.get(key)!.add(callback);

    if (!this.connections.has(key)) {
      this.connect(symbol);
    }
  }

  unsubscribe(symbol: SupportedSymbol, callback: BinanceCallback) {
    const key = symbol.toLowerCase();
    const callbacks = this.callbacks.get(key);

    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.disconnect(symbol);
      }
    }
  }

  private connect(symbol: SupportedSymbol) {
    const key = symbol.toLowerCase();
    // depth@100ms - orderbook updates, aggTrade - trades, bookTicker - best bid/ask
    const streams = `${key}@depth@100ms/${key}@aggTrade/${key}@bookTicker`;
    const url = `${config.binance.wsUrl}/${streams}`;

    console.log(`[Binance] Connecting to ${symbol}...`);

    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[Binance] Connected to ${symbol}`);
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts.set(key, 0);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        const callbacks = this.callbacks.get(key);
        if (callbacks) {
          for (const cb of callbacks) {
            cb(data);
          }
        }
      } catch (error) {
        console.error(`[Binance] Parse error for ${symbol}:`, error);
      }
    };

    ws.onerror = (error) => {
      console.error(`[Binance] WebSocket error for ${symbol}:`, error);
    };

    ws.onclose = () => {
      console.log(`[Binance] Disconnected from ${symbol}`);
      this.connections.delete(key);

      // Reconnect with exponential backoff if there are subscribers
      if (this.callbacks.has(key) && this.callbacks.get(key)!.size > 0) {
        this.scheduleReconnect(symbol);
      }
    };

    this.connections.set(key, ws);
  }

  private scheduleReconnect(symbol: SupportedSymbol) {
    const key = symbol.toLowerCase();
    const attempts = this.reconnectAttempts.get(key) ?? 0;

    if (attempts >= config.ws.maxReconnectAttempts) {
      console.error(`[Binance] Max reconnect attempts (${config.ws.maxReconnectAttempts}) reached for ${symbol}. Giving up.`);
      this.reconnectAttempts.delete(key);
      this.reconnectTimeouts.delete(key);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(
      config.ws.initialReconnectDelayMs * Math.pow(2, attempts),
      config.ws.maxReconnectDelayMs
    );

    console.log(`[Binance] Reconnecting to ${symbol} in ${delay}ms (attempt ${attempts + 1}/${config.ws.maxReconnectAttempts})...`);

    this.reconnectAttempts.set(key, attempts + 1);

    const timeout = setTimeout(() => {
      this.reconnectTimeouts.delete(key);
      // Double-check subscribers still exist
      if (this.callbacks.has(key) && this.callbacks.get(key)!.size > 0) {
        this.connect(symbol);
      }
    }, delay);

    this.reconnectTimeouts.set(key, timeout);
  }

  private disconnect(symbol: SupportedSymbol) {
    const key = symbol.toLowerCase();

    // Cancel any pending reconnect
    const timeout = this.reconnectTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectTimeouts.delete(key);
    }

    // Reset reconnect attempts
    this.reconnectAttempts.delete(key);

    const ws = this.connections.get(key);
    if (ws) {
      ws.close();
      this.connections.delete(key);
    }
    this.callbacks.delete(key);
  }

  async getDepthSnapshot(symbol: SupportedSymbol, limit = 1000): Promise<Result<DepthSnapshot, string>> {
    return this.throttledRest(async () => {
      const url = `${config.binance.restUrl}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`;

      try {
        const response = await fetch(url);

        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const data = await response.json();
        return { success: true, data: data as DepthSnapshot };
      } catch (error) {
        console.error(`[Binance] Network error fetching depth for ${symbol}:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Network error' };
      }
    });
  }

  async getExchangeInfo(): Promise<Result<any, string>> {
    return this.throttledRest(async () => {
      const url = `${config.binance.restUrl}/fapi/v1/exchangeInfo`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const data = await response.json();
        return { success: true, data };
      } catch (error) {
        console.error(`[Binance] Network error fetching exchange info:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Network error' };
      }
    });
  }

  async getTopSymbolsByVolume(): Promise<Result<string[], string>> {
    return this.throttledRest(async () => {
      const url = `${config.binance.restUrl}/fapi/v1/ticker/24hr`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }

      const tickers = await response.json() as SymbolTicker[];

      const MIN_VOLUME_USD = 10_000_000; // $10M minimum
      const MIN_PRICE = 0.001;
      const MAX_TRADES_PER_MILLION = 3_000; // Max 3K trades per $1M volume (protection against wash trading/pump-dump)

      const usdtPerps = tickers.filter(t => {
        if (!t.symbol.endsWith('USDT')) return false;
        if (t.symbol.includes('_')) return false;

        if (!/^[A-Z0-9]+$/.test(t.symbol)) return false;

        const volume = parseFloat(t.quoteVolume);
        const price = parseFloat(t.lastPrice);
        const trades = parseInt(t.count, 10);

        if (volume < MIN_VOLUME_USD) return false;
        if (price < MIN_PRICE) return false;

        const tradesPerMillion = trades / (volume / 1_000_000);
        if (tradesPerMillion > MAX_TRADES_PER_MILLION) {
          console.log(`[Binance] Skipping ${t.symbol}: suspicious trades/volume ratio (${tradesPerMillion.toFixed(0)} trades per $1M)`);
          return false;
        }

        return true;
      });

      usdtPerps.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

      const topSymbols = usdtPerps.slice(0, config.symbols.topCount).map(t => t.symbol);

      console.log(`[Binance] Top ${config.symbols.topCount} symbols by volume:`, topSymbols.join(', '));

        return { success: true, data: topSymbols };
      } catch (error) {
        console.error(`[Binance] Network error fetching tickers:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Network error' };
      }
    });
  }
}

// Singleton
export const binanceClient = new BinanceClient();
