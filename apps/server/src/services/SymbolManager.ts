import { binanceClient } from '../binance/client';

/**
 *
 */

const FALLBACK_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
  'LINKUSDT', 'LTCUSDT', 'ATOMUSDT', 'UNIUSDT', 'ETCUSDT',
  'XLMUSDT', 'APTUSDT', 'FILUSDT', 'ARBUSDT', 'OPUSDT',
];

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

class SymbolManager {
  private symbols: string[] = [...FALLBACK_SYMBOLS];
  private symbolSet: Set<string> = new Set(FALLBACK_SYMBOLS);
  private isInitialized = false;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  /**
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[SymbolManager] Initializing...');

    await this.refreshSymbols();

    this.refreshInterval = setInterval(() => {
      this.refreshSymbols();
    }, REFRESH_INTERVAL_MS);

    this.isInitialized = true;
    console.log(`[SymbolManager] Initialized with ${this.symbols.length} symbols`);
  }

  /**
   */
  private async refreshSymbols(): Promise<void> {
    const result = await binanceClient.getTopSymbolsByVolume();

    if (result.success && result.data.length > 0) {
      this.symbols = result.data;
      this.symbolSet = new Set(result.data);
      console.log(`[SymbolManager] Refreshed: ${this.symbols.join(', ')}`);
    } else {
      console.warn('[SymbolManager] Failed to refresh, using existing symbols:', result.success ? 'empty result' : result.error);
    }
  }

  /**
   */
  getSymbols(): readonly string[] {
    return this.symbols;
  }

  /**
   */
  isSupported(symbol: string): boolean {
    return this.symbolSet.has(symbol);
  }

  /**
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

export const symbolManager = new SymbolManager();
