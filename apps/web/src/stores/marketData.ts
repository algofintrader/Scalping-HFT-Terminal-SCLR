import { create } from 'zustand';
import type {
  OrderBookSnapshotV2,
  OrderBookDeltaV2,
  OrderBookResyncV2,
  ClustersResyncV2,
  ClustersDeltaV2,
  ClusterColumn,
  ClusterCell,
  AggregatedTick,
} from '@sclr/shared';

export interface ClustersState {
  columns: ClusterColumn[];
  interval: number;
  revision: number;
  lastRevision: number;
  needsResync: boolean;
}

/**
 * V2: Clusters with inverted index (price -> openTime -> cell).
 * Allows O(1) lookup by price without network requests.
 */
export interface ClustersStateV2 {
  // Inverted index: price -> openTime -> cell
  priceIndex: Map<string, Map<number, ClusterCell>>;

  // Metadata
  tickSize: string;
  pricePrecision: number;
  latestOpenTime: number;

  // Revisions for gap detection
  revision: number;
  lastRevision: number;
  needsResync: boolean;
}

/**
 * V2: Virtual Skeleton OrderBook State
 * Stores only real bids/asks (qty > 0).
 * Client generates virtual skeleton from midPrice + tickSize.
 */
export interface OrderBookStateV2 {
  bids: Map<string, string>;      // price -> qty (only qty > 0)
  asks: Map<string, string>;      // price -> qty (only qty > 0)
  midPrice: string;
  bestBid: string;
  bestAsk: string;
  tickSize: string;
  pricePrecision: number;
  revision: number;
  lastRevision: number;
  needsResync: boolean;
  serverTimestamp: number;        // server timestamp (from delta/resync)
  clientReceiveTime: number;      // Date.now() when received
}

export interface SymbolData {
  orderbookV2: OrderBookStateV2;
  clusters: ClustersState;
  clustersV2: ClustersStateV2;  // V2: inverted index price -> openTime -> cell
  ticks: AggregatedTick[];
}

/**
 * Preloaded symbol info (tickSize, pricePrecision).
 * Loaded once at app start from /api/symbols.
 * Used as fallback until orderbookV2 is received from server.
 */
export interface SymbolInfo {
  tickSize: string;
  pricePrecision: number;
}

/**
 * Batched OrderBook data for one symbol.
 * All deltas per frame are merged into one object.
 */
export interface BatchedOrderBookDeltaV2 {
  bids: Map<string, string>;  // price -> qty (merged)
  asks: Map<string, string>;  // price -> qty (merged)
  bestBid: string;
  bestAsk: string;
  revision: number;
  prevRevision: number;       // prevRevision of first delta in batch (for gap detection)
  timestamp: number;
}

/**
 * Full batch update for one RAF frame.
 * All data applied in a single Zustand set() call.
 */
export interface FrameBatchUpdate {
  orderbooksV2: Map<string, BatchedOrderBookDeltaV2>;
  clustersV2: Map<string, ClustersDeltaV2[]>;
  ticks: Map<string, AggregatedTick[]>;
}

interface MarketDataState {
  symbols: Record<string, SymbolData>;
  symbolsInfo: Map<string, SymbolInfo>;  // Preloaded symbol info

  // OrderBook actions (V2 - virtual skeleton)
  applyOrderBookSnapshotV2: (symbol: string, snapshot: OrderBookSnapshotV2) => void;
  applyOrderBookDeltaV2: (symbol: string, delta: OrderBookDeltaV2) => void;
  applyOrderBookDeltaV2Batch: (symbol: string, batch: BatchedOrderBookDeltaV2) => void;
  applyOrderBookResyncV2: (symbol: string, resync: OrderBookResyncV2) => void;

  // Clusters actions (legacy — only setClustersNeedsResync remains)
  setClustersNeedsResync: (symbol: string, needs: boolean) => void;

  // Clusters V2 actions (virtual skeleton)
  applyClustersResyncV2: (symbol: string, resync: ClustersResyncV2) => void;
  applyClustersDelataV2: (symbol: string, delta: ClustersDeltaV2) => void;

  // Ticks actions
  addTicks: (symbol: string, ticks: AggregatedTick[]) => void;

  // Batch update (optimization: single set() per frame)
  applyBatchUpdate: (batch: FrameBatchUpdate) => string[];  // returns symbols needing resync

  // SymbolsInfo actions
  setSymbolsInfo: (info: Array<{ symbol: string; tickSize: string | null; pricePrecision: number | null }>) => void;

  // General
  clearSymbol: (symbol: string) => void;
  clearAllTicks: () => void;
}

// Reduced from 500 to 100 — ~70 ticks visible at most, 100 with scroll margin
const MAX_TICKS = 100;

const EMPTY_CLUSTERS: ClustersState = {
  columns: [],
  interval: 5,
  revision: 0,
  lastRevision: 0,
  needsResync: false,
};

const EMPTY_CLUSTERS_V2: ClustersStateV2 = {
  priceIndex: new Map(),
  tickSize: '0.01',
  pricePrecision: 2,
  latestOpenTime: 0,
  revision: 0,
  lastRevision: 0,
  needsResync: false,
};

const EMPTY_ORDERBOOK_V2: OrderBookStateV2 = {
  bids: new Map(),
  asks: new Map(),
  midPrice: '0',
  bestBid: '0',
  bestAsk: '0',
  tickSize: '0.01',
  pricePrecision: 2,
  revision: 0,
  lastRevision: 0,
  needsResync: false,
  serverTimestamp: 0,
  clientReceiveTime: 0,
};

const EMPTY_TICKS: AggregatedTick[] = [];

const createEmptySymbolData = (): SymbolData => ({
  orderbookV2: { ...EMPTY_ORDERBOOK_V2, bids: new Map(), asks: new Map() },
  clusters: { ...EMPTY_CLUSTERS },
  clustersV2: { ...EMPTY_CLUSTERS_V2, priceIndex: new Map() },
  ticks: [],
});

export const useMarketDataStore = create<MarketDataState>((set, get) => {
  // Debug: expose store to window for debugging
  if (typeof window !== 'undefined') {
    (window as any).__marketDataStore = { getState: get };
  }
  return {
  symbols: {},
  symbolsInfo: new Map(),

  // --------------------------------------------------------
  // ORDERBOOK V2 (VIRTUAL SKELETON)
  // --------------------------------------------------------

  applyOrderBookSnapshotV2: (symbol, snapshot) => {
    set((state) => {
      const symbolData = state.symbols[symbol] || createEmptySymbolData();

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            orderbookV2: {
              bids: new Map(),  // Empty - will be filled by deltas
              asks: new Map(),  // Empty - will be filled by deltas
              midPrice: snapshot.midPrice,
              bestBid: snapshot.bestBid,
              bestAsk: snapshot.bestAsk,
              tickSize: snapshot.tickSize,
              pricePrecision: snapshot.pricePrecision,
              revision: snapshot.revision,
              lastRevision: snapshot.revision,
              needsResync: false,
              serverTimestamp: snapshot.timestamp,
              clientReceiveTime: Date.now(),
            },
          },
        },
      };
    });
  },

  applyOrderBookDeltaV2: (symbol, delta) => {
    set((state) => {
      const symbolData = state.symbols[symbol];
      if (!symbolData) return state;

      const obV2 = symbolData.orderbookV2;

      // V2: Gap detection does NOT block data application
      // In V2 architecture data is cumulative — missed deltas are not critical

      // Mutate Maps in-place instead of O(n) copy
      // React triggers from new orderbookV2 object, not from Map contents
      const { bids, asks } = obV2;

      // Apply bid changes (in-place mutation)
      for (const [price, qty] of delta.bids) {
        if (qty === '0' || parseFloat(qty) === 0) {
          bids.delete(price);
        } else {
          bids.set(price, qty);
        }
      }

      // Apply ask changes (in-place mutation)
      for (const [price, qty] of delta.asks) {
        if (qty === '0' || parseFloat(qty) === 0) {
          asks.delete(price);
        } else {
          asks.set(price, qty);
        }
      }

      // Create new orderbookV2 object to trigger React
      // Maps remain the same (mutated), but the wrapper object is new
      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            orderbookV2: {
              ...obV2,
              // bids and asks already mutated — pass same references
              bestBid: delta.bestBid,
              bestAsk: delta.bestAsk,
              revision: delta.revision,
              lastRevision: delta.revision,
              serverTimestamp: delta.timestamp,
              clientReceiveTime: Date.now(),
            },
          },
        },
      };
    });
  },

  /**
   * Batched delta application.
   * All deltas per frame are pre-merged in RenderLoop.
   * One set() instead of 30+ per frame.
   */
  applyOrderBookDeltaV2Batch: (symbol, batch) => {
    set((state) => {
      const symbolData = state.symbols[symbol];
      if (!symbolData) return state;

      const obV2 = symbolData.orderbookV2;
      const { bids, asks } = obV2;

      // Apply merged bids (in-place mutation)
      for (const [price, qty] of batch.bids) {
        if (qty === '0' || parseFloat(qty) === 0) {
          bids.delete(price);
        } else {
          bids.set(price, qty);
        }
      }

      // Apply merged asks (in-place mutation)
      for (const [price, qty] of batch.asks) {
        if (qty === '0' || parseFloat(qty) === 0) {
          asks.delete(price);
        } else {
          asks.set(price, qty);
        }
      }

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            orderbookV2: {
              ...obV2,
              bestBid: batch.bestBid,
              bestAsk: batch.bestAsk,
              revision: batch.revision,
              lastRevision: batch.revision,
              serverTimestamp: batch.timestamp,
              clientReceiveTime: Date.now(),
            },
          },
        },
      };
    });
  },

  applyOrderBookResyncV2: (symbol, resync) => {
    set((state) => {
      const symbolData = state.symbols[symbol] || createEmptySymbolData();

      console.log(`[OrderBookV2] Resync received: ${resync.reason}`);

      // Convert tuple arrays to Maps
      const newBids = new Map<string, string>();
      const newAsks = new Map<string, string>();

      for (const [price, qty] of resync.bids) {
        if (parseFloat(qty) > 0) {
          newBids.set(price, qty);
        }
      }

      for (const [price, qty] of resync.asks) {
        if (parseFloat(qty) > 0) {
          newAsks.set(price, qty);
        }
      }

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            orderbookV2: {
              bids: newBids,
              asks: newAsks,
              midPrice: resync.midPrice,
              bestBid: resync.bestBid,
              bestAsk: resync.bestAsk,
              tickSize: resync.tickSize,
              pricePrecision: resync.pricePrecision,
              revision: resync.revision,
              lastRevision: resync.revision,
              needsResync: false,
              serverTimestamp: resync.timestamp,
              clientReceiveTime: Date.now(),
            },
          },
        },
      };
    });
  },

  // --------------------------------------------------------
  // CLUSTERS (legacy — setClustersNeedsResync kept for compatibility)
  // --------------------------------------------------------

  setClustersNeedsResync: (symbol, needs) => {
    set((state) => {
      const symbolData = state.symbols[symbol];
      if (!symbolData) return state;

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            clusters: {
              ...symbolData.clusters,
              needsResync: needs,
            },
          },
        },
      };
    });
  },

  // --------------------------------------------------------
  // CLUSTERS V2 (VIRTUAL SKELETON)
  // --------------------------------------------------------

  applyClustersResyncV2: (symbol, resync) => {
    set((state) => {
      const symbolData = state.symbols[symbol] || createEmptySymbolData();

      // Build inverted index: price -> openTime -> cell
      const priceIndex = new Map<string, Map<number, ClusterCell>>();

      for (const column of resync.columns) {
        for (const [price, cell] of Object.entries(column.cells)) {
          if (!priceIndex.has(price)) {
            priceIndex.set(price, new Map());
          }
          priceIndex.get(price)!.set(column.openTime, cell);
        }
      }

      const latestOpenTime = resync.columns.length > 0
        ? Math.max(...resync.columns.map(c => c.openTime))
        : 0;

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            clustersV2: {
              priceIndex,
              tickSize: resync.tickSize,
              pricePrecision: resync.pricePrecision,
              latestOpenTime,
              revision: resync.revision,
              lastRevision: resync.revision,
              needsResync: false,
            },
          },
        },
      };
    });
  },

  applyClustersDelataV2: (symbol, delta) => {
    set((state) => {
      const symbolData = state.symbols[symbol];
      if (!symbolData) return state;

      const clustersV2 = symbolData.clustersV2;

      // Gap detection
      if (delta.prevRevision !== clustersV2.lastRevision) {
        console.warn(
          `[ClustersV2] Gap detected! Expected prevRevision=${clustersV2.lastRevision}, got ${delta.prevRevision}`
        );
        return {
          symbols: {
            ...state.symbols,
            [symbol]: {
              ...symbolData,
              clustersV2: {
                ...clustersV2,
                needsResync: true,
              },
            },
          },
        };
      }

      // Mutate priceIndex in-place (like OrderBook V2)
      // React triggers from new clustersV2 object, not from Map contents
      const { priceIndex } = clustersV2;

      for (const [price, cell] of Object.entries(delta.updates)) {
        if (!priceIndex.has(price)) {
          priceIndex.set(price, new Map());
        }
        priceIndex.get(price)!.set(delta.openTime, cell);
      }

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            clustersV2: {
              ...clustersV2,
              // priceIndex already mutated — pass same reference
              latestOpenTime: Math.max(clustersV2.latestOpenTime, delta.openTime),
              revision: delta.revision,
              lastRevision: delta.revision,
            },
          },
        },
      };
    });
  },

  // --------------------------------------------------------
  // TICKS
  // --------------------------------------------------------

  addTicks: (symbol, newTicks) => {
    set((state) => {
      const symbolData = state.symbols[symbol] || createEmptySymbolData();
      // Mutate a shallow copy instead of spread + slice
      const allTicks = symbolData.ticks.slice(); // shallow copy
      allTicks.push(...newTicks);
      if (allTicks.length > MAX_TICKS) {
        allTicks.splice(0, allTicks.length - MAX_TICKS);
      }

      return {
        symbols: {
          ...state.symbols,
          [symbol]: {
            ...symbolData,
            ticks: allTicks,
          },
        },
      };
    });
  },

  // --------------------------------------------------------
  // BATCH UPDATE (single set() per frame)
  // --------------------------------------------------------

  /**
   * Applies ALL data for one RAF frame in a single set() call.
   * Saves 2-4ms by reducing shallow copies.
   *
   * Returns array of symbols needing resync (for caller to handle).
   */
  applyBatchUpdate: (batch) => {
    const symbolsToResync: string[] = [];

    set((state) => {
      const newSymbols = { ...state.symbols };

      // 1. Apply OrderBook V2 deltas
      for (const [symbol, obBatch] of batch.orderbooksV2) {
        const symbolData = newSymbols[symbol] || createEmptySymbolData();
        const obV2 = symbolData.orderbookV2;

        // Gap detection: verify prevRevision of first delta matches lastRevision
        // If gap detected — request resync and skip delta
        if (obBatch.prevRevision !== 0 && obV2.lastRevision !== 0 &&
            obBatch.prevRevision !== obV2.lastRevision) {
          console.warn(
            `[OrderBookV2] ${symbol} Gap detected! expected prevRevision=${obV2.lastRevision}, got ${obBatch.prevRevision}`
          );
          symbolsToResync.push(symbol);
          // Mark needsResync for UI
          newSymbols[symbol] = {
            ...symbolData,
            orderbookV2: {
              ...obV2,
              needsResync: true,
            },
          };
          continue; // Skip this delta, wait for resync
        }

        const { bids, asks } = obV2;

        // Apply merged bids (in-place mutation)
        for (const [price, qty] of obBatch.bids) {
          if (qty === '0' || parseFloat(qty) === 0) {
            bids.delete(price);
          } else {
            bids.set(price, qty);
          }
        }

        // Apply merged asks (in-place mutation)
        for (const [price, qty] of obBatch.asks) {
          if (qty === '0' || parseFloat(qty) === 0) {
            asks.delete(price);
          } else {
            asks.set(price, qty);
          }
        }

        newSymbols[symbol] = {
          ...symbolData,
          orderbookV2: {
            ...obV2,
            bestBid: obBatch.bestBid,
            bestAsk: obBatch.bestAsk,
            revision: obBatch.revision,
            lastRevision: obBatch.revision,
            needsResync: false,  // Reset flag on successful application
            serverTimestamp: obBatch.timestamp,
            clientReceiveTime: Date.now(),
          },
        };
      }

      // 2. Apply Clusters V2 deltas
      for (const [symbol, deltas] of batch.clustersV2) {
        let symbolData = newSymbols[symbol] || createEmptySymbolData();
        let clustersV2 = symbolData.clustersV2;
        const { priceIndex } = clustersV2;

        for (const delta of deltas) {
          // Gap detection
          if (delta.prevRevision !== clustersV2.lastRevision) {
            console.warn(
              `[ClustersV2] Gap detected! Expected prevRevision=${clustersV2.lastRevision}, got ${delta.prevRevision}`
            );
            symbolsToResync.push(symbol);
            clustersV2 = { ...clustersV2, needsResync: true };
            continue;
          }

          // Apply updates (in-place mutation)
          for (const [price, cell] of Object.entries(delta.updates)) {
            if (!priceIndex.has(price)) {
              priceIndex.set(price, new Map());
            }
            priceIndex.get(price)!.set(delta.openTime, cell);
          }

          clustersV2 = {
            ...clustersV2,
            latestOpenTime: Math.max(clustersV2.latestOpenTime, delta.openTime),
            revision: delta.revision,
            lastRevision: delta.revision,
          };
        }

        newSymbols[symbol] = { ...symbolData, clustersV2 };
      }

      // 3. Apply Ticks
      for (const [symbol, newTicks] of batch.ticks) {
        if (newTicks.length === 0) continue;

        const symbolData = newSymbols[symbol] || createEmptySymbolData();
        // Copy array to prevent race condition with concurrent readers
        const allTicks = symbolData.ticks.slice();

        allTicks.push(...newTicks);
        if (allTicks.length > MAX_TICKS) {
          allTicks.splice(0, allTicks.length - MAX_TICKS);
        }

        newSymbols[symbol] = { ...symbolData, ticks: allTicks };
      }

      return { symbols: newSymbols };
    });

    // Return symbols for resync — RenderLoop will handle them
    return symbolsToResync;
  },

  // --------------------------------------------------------
  // SYMBOLS INFO (preloaded data)
  // --------------------------------------------------------

  setSymbolsInfo: (info) => {
    const newMap = new Map<string, SymbolInfo>();
    for (const item of info) {
      if (item.tickSize && item.pricePrecision !== null) {
        newMap.set(item.symbol, {
          tickSize: item.tickSize,
          pricePrecision: item.pricePrecision,
        });
      }
    }
    console.log(`[MarketData] Loaded symbolsInfo for ${newMap.size} symbols`);
    set({ symbolsInfo: newMap });
  },

  // --------------------------------------------------------
  // GENERAL
  // --------------------------------------------------------

  clearSymbol: (symbol) => {
    set((state) => {
      const symbolData = state.symbols[symbol];
      if (symbolData) {
        // Explicitly clear Maps to speed up GC
        symbolData.orderbookV2?.bids?.clear();
        symbolData.orderbookV2?.asks?.clear();
        symbolData.clustersV2?.priceIndex?.clear();
      }
      const { [symbol]: _, ...rest } = state.symbols;
      return { symbols: rest };
    });
    clearSelectorCaches(symbol);
  },

  clearAllTicks: () => {
    set((state) => {
      const newSymbols: typeof state.symbols = {};
      for (const [symbol, data] of Object.entries(state.symbols)) {
        newSymbols[symbol] = { ...data, ticks: [] };
      }
      return { symbols: newSymbols };
    });
    console.log('[Store] Cleared all ticks');
  },
}});

type SelectorFn<T> = (state: MarketDataState) => T;

/**
 */
function clearSelectorCaches(symbol: string): void {
  for (const cache of Object.values(selectorCaches)) {
    cache.delete(symbol);
  }
}

const selectorCaches = {
  clusters: new Map<string, SelectorFn<ClustersState | null>>(),
  clustersNeedsResync: new Map<string, SelectorFn<boolean>>(),
  ticks: new Map<string, SelectorFn<AggregatedTick[]>>(),
  orderbookV2: new Map<string, SelectorFn<OrderBookStateV2 | null>>(),
  bidsV2: new Map<string, SelectorFn<Map<string, string> | null>>(),
  asksV2: new Map<string, SelectorFn<Map<string, string> | null>>(),
  midPriceV2: new Map<string, SelectorFn<string>>(),
  tickSizeV2: new Map<string, SelectorFn<string>>(),
  pricePrecisionV2: new Map<string, SelectorFn<number>>(),
  orderbookV2NeedsResync: new Map<string, SelectorFn<boolean>>(),
  clustersV2: new Map<string, SelectorFn<ClustersStateV2 | null>>(),
  clustersV2PriceIndex: new Map<string, SelectorFn<Map<string, Map<number, ClusterCell>> | null>>(),
  clustersV2NeedsResync: new Map<string, SelectorFn<boolean>>(),
  symbolInfo: new Map<string, SelectorFn<SymbolInfo | null>>(),
};

export const selectClusters = (symbol: string) => {
  if (!selectorCaches.clusters.has(symbol)) {
    selectorCaches.clusters.set(symbol, (state) => state.symbols[symbol]?.clusters ?? null);
  }
  return selectorCaches.clusters.get(symbol)!;
};

export const selectClustersNeedsResync = (symbol: string) => {
  if (!selectorCaches.clustersNeedsResync.has(symbol)) {
    selectorCaches.clustersNeedsResync.set(symbol, (state) => state.symbols[symbol]?.clusters?.needsResync ?? false);
  }
  return selectorCaches.clustersNeedsResync.get(symbol)!;
};

export const selectTicks = (symbol: string) => {
  if (!selectorCaches.ticks.has(symbol)) {
    selectorCaches.ticks.set(symbol, (state) => state.symbols[symbol]?.ticks ?? EMPTY_TICKS);
  }
  return selectorCaches.ticks.get(symbol)!;
};

export const selectOrderBookV2 = (symbol: string) => {
  if (!selectorCaches.orderbookV2.has(symbol)) {
    selectorCaches.orderbookV2.set(symbol, (state) => state.symbols[symbol]?.orderbookV2 ?? null);
  }
  return selectorCaches.orderbookV2.get(symbol)!;
};

export const selectBidsV2 = (symbol: string) => {
  if (!selectorCaches.bidsV2.has(symbol)) {
    selectorCaches.bidsV2.set(symbol, (state) => state.symbols[symbol]?.orderbookV2?.bids ?? null);
  }
  return selectorCaches.bidsV2.get(symbol)!;
};

export const selectAsksV2 = (symbol: string) => {
  if (!selectorCaches.asksV2.has(symbol)) {
    selectorCaches.asksV2.set(symbol, (state) => state.symbols[symbol]?.orderbookV2?.asks ?? null);
  }
  return selectorCaches.asksV2.get(symbol)!;
};

export const selectMidPriceV2 = (symbol: string) => {
  if (!selectorCaches.midPriceV2.has(symbol)) {
    selectorCaches.midPriceV2.set(symbol, (state) => state.symbols[symbol]?.orderbookV2?.midPrice ?? '0');
  }
  return selectorCaches.midPriceV2.get(symbol)!;
};

export const selectTickSizeV2 = (symbol: string) => {
  if (!selectorCaches.tickSizeV2.has(symbol)) {
    selectorCaches.tickSizeV2.set(symbol, (state) => state.symbols[symbol]?.orderbookV2?.tickSize ?? '0.01');
  }
  return selectorCaches.tickSizeV2.get(symbol)!;
};

export const selectPricePrecisionV2 = (symbol: string) => {
  if (!selectorCaches.pricePrecisionV2.has(symbol)) {
    selectorCaches.pricePrecisionV2.set(symbol, (state) => state.symbols[symbol]?.orderbookV2?.pricePrecision ?? 2);
  }
  return selectorCaches.pricePrecisionV2.get(symbol)!;
};

export const selectOrderBookV2NeedsResync = (symbol: string) => {
  if (!selectorCaches.orderbookV2NeedsResync.has(symbol)) {
    selectorCaches.orderbookV2NeedsResync.set(symbol, (state) => state.symbols[symbol]?.orderbookV2?.needsResync ?? false);
  }
  return selectorCaches.orderbookV2NeedsResync.get(symbol)!;
};

export const selectClustersV2 = (symbol: string) => {
  if (!selectorCaches.clustersV2.has(symbol)) {
    selectorCaches.clustersV2.set(symbol, (state) => state.symbols[symbol]?.clustersV2 ?? null);
  }
  return selectorCaches.clustersV2.get(symbol)!;
};

export const selectClustersV2PriceIndex = (symbol: string) => {
  if (!selectorCaches.clustersV2PriceIndex.has(symbol)) {
    selectorCaches.clustersV2PriceIndex.set(symbol, (state) => state.symbols[symbol]?.clustersV2?.priceIndex ?? null);
  }
  return selectorCaches.clustersV2PriceIndex.get(symbol)!;
};

export const selectClustersV2NeedsResync = (symbol: string) => {
  if (!selectorCaches.clustersV2NeedsResync.has(symbol)) {
    selectorCaches.clustersV2NeedsResync.set(symbol, (state) => state.symbols[symbol]?.clustersV2?.needsResync ?? false);
  }
  return selectorCaches.clustersV2NeedsResync.get(symbol)!;
};

export const selectSymbolInfo = (symbol: string) => {
  if (!selectorCaches.symbolInfo.has(symbol)) {
    selectorCaches.symbolInfo.set(symbol, (state) => state.symbolsInfo.get(symbol) ?? null);
  }
  return selectorCaches.symbolInfo.get(symbol)!;
};
