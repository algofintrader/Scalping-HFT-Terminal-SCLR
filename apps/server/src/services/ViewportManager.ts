import { ORDERBOOK_CONFIG, type SupportedSymbol } from '@sclr/shared';

export interface ClientViewport {
  clientId: string;
  symbol: SupportedSymbol;
  centerPrice: string;
  viewportSize: number;
  lastOrderBookRevision: number;
  lastClustersRevision: number;
}

function makeKey(clientId: string, symbol: SupportedSymbol): string {
  return `${clientId}:${symbol}`;
}

class ViewportManager {
  private viewports = new Map<string, ClientViewport>();
  private symbolIndex = new Map<SupportedSymbol, Set<string>>();
  private clientIndex = new Map<string, Set<string>>();

  /**
   */
  register(clientId: string, symbol: SupportedSymbol, centerPrice: string): void {
    const key = makeKey(clientId, symbol);

    this.viewports.set(key, {
      clientId,
      symbol,
      centerPrice,
      viewportSize: ORDERBOOK_CONFIG.DEFAULT_VIEWPORT_SIZE,
      lastOrderBookRevision: 0,
      lastClustersRevision: 0,
    });

    if (!this.symbolIndex.has(symbol)) {
      this.symbolIndex.set(symbol, new Set());
    }
    this.symbolIndex.get(symbol)!.add(key);

    if (!this.clientIndex.has(clientId)) {
      this.clientIndex.set(clientId, new Set());
    }
    this.clientIndex.get(clientId)!.add(key);

    console.log(`[ViewportManager] Client ${clientId} registered for ${symbol}, center=${centerPrice}`);
  }

  /**
   */
  unregister(clientId: string, symbol: SupportedSymbol): void {
    const key = makeKey(clientId, symbol);
    const viewport = this.viewports.get(key);

    if (viewport) {
      const symbolKeys = this.symbolIndex.get(symbol);
      if (symbolKeys) {
        symbolKeys.delete(key);
        if (symbolKeys.size === 0) {
          this.symbolIndex.delete(symbol);
        }
      }

      const clientKeys = this.clientIndex.get(clientId);
      if (clientKeys) {
        clientKeys.delete(key);
        if (clientKeys.size === 0) {
          this.clientIndex.delete(clientId);
        }
      }

      this.viewports.delete(key);
      console.log(`[ViewportManager] Client ${clientId} unregistered from ${symbol}`);
    }
  }

  /**
   */
  unregisterAll(clientId: string): void {
    const clientKeys = this.clientIndex.get(clientId);
    if (!clientKeys) return;

    for (const key of clientKeys) {
      const viewport = this.viewports.get(key);
      if (viewport) {
        const symbolKeys = this.symbolIndex.get(viewport.symbol);
        if (symbolKeys) {
          symbolKeys.delete(key);
          if (symbolKeys.size === 0) {
            this.symbolIndex.delete(viewport.symbol);
          }
        }
        this.viewports.delete(key);
      }
    }

    this.clientIndex.delete(clientId);
    console.log(`[ViewportManager] Client ${clientId} unregistered from all symbols`);
  }

  /**
   */
  updateViewport(clientId: string, symbol: SupportedSymbol, centerPrice: string, viewportSize?: number): void {
    const key = makeKey(clientId, symbol);
    const viewport = this.viewports.get(key);
    if (!viewport) return;

    viewport.centerPrice = centerPrice;
    if (viewportSize) {
      viewport.viewportSize = viewportSize;
    }
  }

  /**
   */
  get(clientId: string, symbol: SupportedSymbol): ClientViewport | undefined {
    return this.viewports.get(makeKey(clientId, symbol));
  }

  /**
   */
  getClientsForSymbol(symbol: SupportedSymbol): ClientViewport[] {
    const keys = this.symbolIndex.get(symbol);
    if (!keys || keys.size === 0) return [];

    const result: ClientViewport[] = [];
    for (const key of keys) {
      const viewport = this.viewports.get(key);
      if (viewport) {
        result.push(viewport);
      }
    }
    return result;
  }

  /**
   */
  hasClientsForSymbol(symbol: SupportedSymbol): boolean {
    const keys = this.symbolIndex.get(symbol);
    return keys !== undefined && keys.size > 0;
  }

  /**
   */
  getClientCountForSymbol(symbol: SupportedSymbol): number {
    return this.symbolIndex.get(symbol)?.size ?? 0;
  }

  /**
   */
  updateOrderBookRevision(clientId: string, symbol: SupportedSymbol, revision: number): void {
    const key = makeKey(clientId, symbol);
    const viewport = this.viewports.get(key);
    if (viewport) {
      viewport.lastOrderBookRevision = revision;
    }
  }

  /**
   */
  updateClustersRevision(clientId: string, symbol: SupportedSymbol, revision: number): void {
    const key = makeKey(clientId, symbol);
    const viewport = this.viewports.get(key);
    if (viewport) {
      viewport.lastClustersRevision = revision;
    }
  }
}

export const viewportManager = new ViewportManager();
