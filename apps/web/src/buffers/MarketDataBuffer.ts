/**
 * DELTA BUFFER LAYER (v2)
 *
 * Buffer stores only CHANGES (deltas), not full state.
 * Zustand remains the single source of truth.
 * On flush, deltas are applied to existing Zustand state.
 *
 * Architecture:
 * WS message → Buffer.queue(delta) → [accumulate]
 *                                          ↓ RAF tick
 *                               Buffer.flush() → returns accumulated deltas
 *                                          ↓
 *                               Zustand.applyDeltas() → updates state
 */

import type {
  OrderBookSnapshotV2,
  OrderBookDeltaV2,
  OrderBookResyncV2,
  ClustersResyncV2,
  ClustersDeltaV2,
  AggregatedTick,
} from '@sclr/shared';

// V2: Clusters Virtual Skeleton updates
export interface PendingClustersUpdateV2 {
  type: 'resync_v2' | 'delta_v2';
  data: ClustersResyncV2 | ClustersDeltaV2;
}

// V2: Virtual Skeleton OrderBook updates
export interface PendingOrderBookUpdateV2 {
  type: 'snapshot_v2' | 'delta_v2' | 'resync_v2';
  data: OrderBookSnapshotV2 | OrderBookDeltaV2 | OrderBookResyncV2;
}

export interface FlushResult {
  orderbooksV2: Map<string, PendingOrderBookUpdateV2[]>;
  clustersV2: Map<string, PendingClustersUpdateV2[]>;
  ticks: Map<string, AggregatedTick[]>;
}

// Backpressure: cap queue size to prevent accumulating lag
const MAX_QUEUE_SIZE = 50;

class MarketDataBuffer {
  // Queues of accumulated deltas (NOT full state!)
  private pendingOrderbooksV2 = new Map<string, PendingOrderBookUpdateV2[]>();
  private pendingClustersV2 = new Map<string, PendingClustersUpdateV2[]>();
  private pendingTicks = new Map<string, AggregatedTick[]>();

  // --------------------------------------------------------
  // ORDERBOOK V2 (VIRTUAL SKELETON)
  // --------------------------------------------------------

  queueOrderBookSnapshotV2(symbol: string, snapshot: OrderBookSnapshotV2): void {
    // Snapshot replaces all previous updates
    this.pendingOrderbooksV2.set(symbol, [{ type: 'snapshot_v2', data: snapshot }]);
  }

  queueOrderBookDeltaV2(symbol: string, delta: OrderBookDeltaV2): void {
    const queue = this.pendingOrderbooksV2.get(symbol) || [];

    // BACKPRESSURE: merge old deltas instead of dropping to avoid data loss
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Find all deltas and merge into one consolidated delta
      const deltas: OrderBookDeltaV2[] = [];
      const nonDeltas: PendingOrderBookUpdateV2[] = [];

      for (const update of queue) {
        if (update.type === 'delta_v2') {
          deltas.push(update.data as OrderBookDeltaV2);
        } else {
          nonDeltas.push(update);
        }
      }

      if (deltas.length > 1) {
        // FIXED: Verify revisions are sequential before merge
        // If there's a gap, let RenderLoop detect it and request resync
        let hasGap = false;
        for (let i = 1; i < deltas.length; i++) {
          if (deltas[i]!.prevRevision !== deltas[i - 1]!.revision) {
            hasGap = true;
            console.warn(`[Buffer] Gap detected in merge: expected prevRevision=${deltas[i - 1]!.revision}, got ${deltas[i]!.prevRevision}`);
            break;
          }
        }

        // Merge all deltas into one
        const mergedBids: [string, string][] = [];
        const mergedAsks: [string, string][] = [];
        const bidsMap = new Map<string, string>();
        const asksMap = new Map<string, string>();

        for (const d of deltas) {
          for (const [p, q] of d.bids) bidsMap.set(p, q);
          for (const [p, q] of d.asks) asksMap.set(p, q);
        }

        for (const [p, q] of bidsMap) mergedBids.push([p, q]);
        for (const [p, q] of asksMap) mergedAsks.push([p, q]);

        const firstDelta = deltas[0]!;
        const lastDelta = deltas[deltas.length - 1]!;
        const consolidated: OrderBookDeltaV2 = {
          symbol: lastDelta.symbol,
          bids: mergedBids,
          asks: mergedAsks,
          bestBid: lastDelta.bestBid,
          bestAsk: lastDelta.bestAsk,
          revision: lastDelta.revision,
          // FIXED: If there's a gap, set prevRevision=-1 to trigger gap detection
          prevRevision: hasGap ? -1 : firstDelta.prevRevision,
          timestamp: lastDelta.timestamp,
        };

        // Clear queue and add non-deltas + consolidated
        queue.length = 0;
        queue.push(...nonDeltas);
        queue.push({ type: 'delta_v2', data: consolidated });
      }
    }

    queue.push({ type: 'delta_v2', data: delta });
    this.pendingOrderbooksV2.set(symbol, queue);
  }

  queueOrderBookResyncV2(symbol: string, resync: OrderBookResyncV2): void {
    // Resync replaces all previous updates
    this.pendingOrderbooksV2.set(symbol, [{ type: 'resync_v2', data: resync }]);
  }

  // --------------------------------------------------------
  // CLUSTERS V2 (VIRTUAL SKELETON)
  // --------------------------------------------------------

  queueClustersResyncV2(symbol: string, resync: ClustersResyncV2): void {
    // Resync replaces all previous updates
    this.pendingClustersV2.set(symbol, [{ type: 'resync_v2', data: resync }]);
  }

  queueClustersDeltaV2(symbol: string, delta: ClustersDeltaV2): void {
    const queue = this.pendingClustersV2.get(symbol) || [];

    // BACKPRESSURE: merge deltas instead of dropping
    // Cluster volumes are cumulative — latest value for {price, openTime} wins
    if (queue.length >= MAX_QUEUE_SIZE) {
      const deltas: ClustersDeltaV2[] = [];
      const nonDeltas: PendingClustersUpdateV2[] = [];

      for (const update of queue) {
        if (update.type === 'delta_v2') {
          deltas.push(update.data as ClustersDeltaV2);
        } else {
          nonDeltas.push(update);
        }
      }

      if (deltas.length > 1) {
        // Group deltas by openTime and merge updates
        const byOpenTime = new Map<number, ClustersDeltaV2>();

        for (const d of deltas) {
          const existing = byOpenTime.get(d.openTime);
          if (existing) {
            // Merge updates: newer values overwrite older
            existing.updates = { ...existing.updates, ...d.updates };
            existing.revision = d.revision;
            existing.timestamp = d.timestamp;
          } else {
            // Clone to avoid mutating the original
            byOpenTime.set(d.openTime, { ...d, updates: { ...d.updates } });
          }
        }

        // Clear queue and add non-deltas + merged deltas
        queue.length = 0;
        queue.push(...nonDeltas);
        for (const merged of byOpenTime.values()) {
          queue.push({ type: 'delta_v2', data: merged });
        }
      }
    }

    queue.push({ type: 'delta_v2', data: delta });
    this.pendingClustersV2.set(symbol, queue);
  }

  // --------------------------------------------------------
  // TICKS
  // --------------------------------------------------------

  queueTicks(symbol: string, ticks: AggregatedTick[]): void {
    const existing = this.pendingTicks.get(symbol) || [];
    existing.push(...ticks);
    // BACKPRESSURE: cap tick queue size, keep most recent
    if (existing.length > MAX_QUEUE_SIZE) {
      existing.splice(0, existing.length - MAX_QUEUE_SIZE);
    }
    this.pendingTicks.set(symbol, existing);
  }

  // --------------------------------------------------------
  // FLUSH - returns accumulated deltas for applying to Zustand
  // --------------------------------------------------------

  flush(): FlushResult | null {
    if (this.pendingOrderbooksV2.size === 0 &&
        this.pendingClustersV2.size === 0 &&
        this.pendingTicks.size === 0) {
      return null;
    }

    // Pass original Maps without copying; create new empty Maps for the next cycle
    const result: FlushResult = {
      orderbooksV2: this.pendingOrderbooksV2,
      clustersV2: this.pendingClustersV2,
      ticks: this.pendingTicks,
    };

    // New empty Maps instead of clear() — faster and safer
    this.pendingOrderbooksV2 = new Map();
    this.pendingClustersV2 = new Map();
    this.pendingTicks = new Map();

    return result;
  }

  // --------------------------------------------------------
  // UTILITY
  // --------------------------------------------------------

  clearSymbol(symbol: string): void {
    this.pendingOrderbooksV2.delete(symbol);
    this.pendingClustersV2.delete(symbol);
    this.pendingTicks.delete(symbol);
  }

  /** Clears ALL pending data. Used on tab return — all data is stale. */
  clearAll(): void {
    this.pendingOrderbooksV2.clear();
    this.pendingClustersV2.clear();
    this.pendingTicks.clear();
    console.log('[Buffer] Cleared all pending data');
  }

  getStats(): { pendingOBV2: number; pendingClustersV2: number; pendingTicks: number } {
    return {
      pendingOBV2: this.pendingOrderbooksV2.size,
      pendingClustersV2: this.pendingClustersV2.size,
      pendingTicks: this.pendingTicks.size,
    };
  }
}

// Singleton
export const marketDataBuffer = new MarketDataBuffer();

// Debug
if (typeof window !== 'undefined') {
  (window as any).__marketDataBuffer = marketDataBuffer;
}
