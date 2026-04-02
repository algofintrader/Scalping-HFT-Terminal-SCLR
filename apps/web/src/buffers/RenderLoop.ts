/**
 * RAF RENDER LOOP (v2)
 *
 * Simple loop: takes accumulated deltas from Buffer,
 * calls existing Zustand store methods.
 *
 * Zustand remains the single source of truth.
 * No data processing logic here.
 */

import { marketDataBuffer, type FlushResult } from './MarketDataBuffer';
import { useMarketDataStore, type BatchedOrderBookDeltaV2, type FrameBatchUpdate } from '../stores/marketData';
import { useConnectionStore } from '../stores/connection';
import { useWorkspaceStore } from '../stores/workspace';
import type {
  OrderBookSnapshotV2, OrderBookDeltaV2, OrderBookResyncV2,
  ClustersResyncV2, ClustersDeltaV2
} from '@sclr/shared';

class RenderLoop {
  private rafId: number | null = null;
  private isRunning = false;

  // Performance tracking
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private fps = 0;
  private lastFlushTime = 0;
  private avgFlushTime = 0;

  // Tab visibility tracking — clear stale data on return
  private wasHidden = false;
  // FIXED: Debounce for visibility — prevents livelock on rapid tab switching
  private lastVisibilityChangeTime = 0;
  private readonly VISIBILITY_DEBOUNCE_MS = 100;

  // Reusable Maps for merging (avoid allocations in RAF)
  private mergedBidsPool = new Map<string, string>();
  private mergedAsksPool = new Map<string, string>();

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastFpsUpdate = performance.now();
    this.tick();

    console.log('[RenderLoop] Started');
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isRunning = false;
    console.log('[RenderLoop] Stopped');
  }

  private tick = (): void => {
    if (!this.isRunning) return;

    // VISIBILITY CHECK: clear stale data on tab return
    // This MUST be first — before flush()!
    const now = performance.now();
    if (this.wasHidden && !document.hidden) {
      // FIXED: Debounce — ignore if visibility changed too rapidly
      if (now - this.lastVisibilityChangeTime < this.VISIBILITY_DEBOUNCE_MS) {
        this.wasHidden = false;
        this.rafId = requestAnimationFrame(this.tick);
        return;
      }

      console.log('[RenderLoop] Tab returned from background, clearing stale data...');

      // 1. Clear accumulated stale data in buffer
      marketDataBuffer.clearAll();

      // 2. Clear stale ticks in store
      useMarketDataStore.getState().clearAllTicks();

      // 3. Request fresh data
      const instruments = useWorkspaceStore.getState().instruments;
      const { requestResync, isConnected } = useConnectionStore.getState();

      if (isConnected) {
        for (const instrument of instruments) {
          requestResync(instrument.symbol);
        }
        console.log(`[RenderLoop] Requested resync for ${instruments.length} symbols`);
      }

      this.wasHidden = false;
      this.lastVisibilityChangeTime = now;

      // Skip this frame — buffer is empty, waiting for resync
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    // Update flag for next tick
    if (this.wasHidden !== document.hidden) {
      this.lastVisibilityChangeTime = now;
    }
    this.wasHidden = document.hidden;

    // FPS tracking
    this.frameCount++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // Flush and apply to Zustand
    const flushStart = performance.now();
    const result = marketDataBuffer.flush();

    if (result) {
      this.applyToZustand(result);
    }

    this.lastFlushTime = performance.now() - flushStart;
    this.avgFlushTime = this.avgFlushTime * 0.9 + this.lastFlushTime * 0.1;

    // Next frame
    this.rafId = requestAnimationFrame(this.tick);
  };

  private applyToZustand(result: FlushResult): void {
    const store = useMarketDataStore.getState();

    // STEP 1: Process snapshot/resync (require separate calls)

    // OrderBook snapshots/resyncs
    for (const [symbol, updates] of result.orderbooksV2) {
      for (const update of updates) {
        if (update.type === 'snapshot_v2') {
          store.applyOrderBookSnapshotV2(symbol, update.data as OrderBookSnapshotV2);
        } else if (update.type === 'resync_v2') {
          store.applyOrderBookResyncV2(symbol, update.data as OrderBookResyncV2);
        }
      }
    }

    // Clusters V2 resyncs
    for (const [symbol, updates] of result.clustersV2) {
      for (const update of updates) {
        if (update.type === 'resync_v2') {
          store.applyClustersResyncV2(symbol, update.data as ClustersResyncV2);
        }
      }
    }

    // STEP 2: Collect ALL deltas into one batch

    const batchOrderbooks = new Map<string, BatchedOrderBookDeltaV2>();
    const batchClustersV2 = new Map<string, ClustersDeltaV2[]>();

    // Collect OrderBook deltas
    for (const [symbol, updates] of result.orderbooksV2) {
      // Reuse pooled Maps instead of allocating new ones
      this.mergedBidsPool.clear();
      this.mergedAsksPool.clear();

      let lastBestBid = '';
      let lastBestAsk = '';
      let lastRevision = 0;
      let firstPrevRevision = 0;  // prevRevision of first delta (for gap detection)
      let lastTimestamp = 0;
      let hasDeltas = false;

      for (const update of updates) {
        if (update.type === 'delta_v2') {
          const delta = update.data as OrderBookDeltaV2;

          // Remember prevRevision of first delta for gap detection
          if (!hasDeltas) {
            firstPrevRevision = delta.prevRevision;
          }

          hasDeltas = true;
          for (const [price, qty] of delta.bids) {
            this.mergedBidsPool.set(price, qty);
          }
          for (const [price, qty] of delta.asks) {
            this.mergedAsksPool.set(price, qty);
          }
          lastBestBid = delta.bestBid;
          lastBestAsk = delta.bestAsk;
          lastRevision = delta.revision;
          lastTimestamp = delta.timestamp;
        }
      }

      if (hasDeltas) {
        // Copy from pool to result (pool will be reused for next symbol)
        batchOrderbooks.set(symbol, {
          bids: new Map(this.mergedBidsPool),
          asks: new Map(this.mergedAsksPool),
          bestBid: lastBestBid,
          bestAsk: lastBestAsk,
          revision: lastRevision,
          prevRevision: firstPrevRevision,  // Gap detection
          timestamp: lastTimestamp,
        });
      }
    }

    // Collect Clusters V2 deltas
    for (const [symbol, updates] of result.clustersV2) {
      const deltas: ClustersDeltaV2[] = [];
      for (const update of updates) {
        if (update.type === 'delta_v2') {
          deltas.push(update.data as ClustersDeltaV2);
        }
      }
      if (deltas.length > 0) {
        batchClustersV2.set(symbol, deltas);
      }
    }

    // STEP 3: Apply ALL deltas in a SINGLE set() call

    if (batchOrderbooks.size > 0 || batchClustersV2.size > 0 || result.ticks.size > 0) {
      const batch: FrameBatchUpdate = {
        orderbooksV2: batchOrderbooks,
        clustersV2: batchClustersV2,
        ticks: result.ticks,
      };

      const symbolsToResync = store.applyBatchUpdate(batch);

      // Request resync for symbols with gap
      if (symbolsToResync.length > 0) {
        const connectionStore = useConnectionStore.getState();
        for (const symbol of symbolsToResync) {
          connectionStore.requestResync(symbol);
        }
      }
    }
  }

  getStats(): { fps: number; flushTime: number; avgFlushTime: number } {
    return {
      fps: this.fps,
      flushTime: this.lastFlushTime,
      avgFlushTime: Math.round(this.avgFlushTime * 100) / 100,
    };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

// Singleton
export const renderLoop = new RenderLoop();

// Auto-start
if (typeof window !== 'undefined') {
  renderLoop.start();
  (window as any).__renderLoop = renderLoop;
}
