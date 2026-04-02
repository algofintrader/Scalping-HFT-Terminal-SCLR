/**
 * InstrumentPanelV2 - Virtual Skeleton Architecture
 *
 */

import { useRef, useCallback, useMemo, useState, memo, useEffect } from 'react';
import { useWorkspaceStore, type Instrument } from '../stores/workspace';
import { useMarketDataStore, selectOrderBookV2 } from '../stores/marketData';
import { SyncedClustersV2, type SyncedClustersV2Ref } from './SyncedClustersV2';
import { SyncedOrderBookV2, type SyncedOrderBookV2Ref } from './SyncedOrderBookV2';
import { TickChart } from './TickChart';
import { LoadingOverlay } from './LoadingOverlay';
import { CLIENT_CONFIG } from '../config';

const COMPACT_THRESHOLD = 550;

interface Props {
  instrument: Instrument;
}

function getMaxClusterColumns(instrumentCount: number): number {
  if (instrumentCount <= 1) return 6;
  if (instrumentCount === 2) return 4;
  return 2;
}

export const InstrumentPanelV2 = memo(function InstrumentPanelV2({ instrument }: Props) {
  const { removeInstrument, instruments } = useWorkspaceStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(400);

  const compact = panelWidth < COMPACT_THRESHOLD;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPanelWidth(entry.contentRect.width);
      }
    });

    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // V2 OrderBook state
  const orderbookV2 = useMarketDataStore(selectOrderBookV2(instrument.symbol));
  const bestBid = orderbookV2?.bestBid ?? '0';
  const bestAsk = orderbookV2?.bestAsk ?? '0';
  const tickSize = orderbookV2?.tickSize ?? '0.01';

  const tickSizeNum = parseFloat(tickSize);

  // Shared skeleton center price for syncing OrderBook and Clusters
  const [skeletonCenterPrice, setSkeletonCenterPrice] = useState<number>(0);

  const [visiblePriceRange, setVisiblePriceRange] = useState<{ min: number; max: number } | null>(null);

  const clustersRef = useRef<SyncedClustersV2Ref>(null);
  const orderbookRef = useRef<SyncedOrderBookV2Ref>(null);

  // Reset on symbol change
  useEffect(() => {
    setSkeletonCenterPrice(0);
    setVisiblePriceRange(null);
  }, [instrument.symbol]);

  // Sync scroll from OrderBook to Clusters
  const handleOrderBookScroll = useCallback((newScrollTop: number) => {
    if (clustersRef.current) {
      clustersRef.current.scrollTo(newScrollTop);
    }
  }, []);

  // Handle skeleton center change from OrderBook
  const handleSkeletonCenterChange = useCallback((newCenter: number, newScrollTop?: number) => {
    setSkeletonCenterPrice(newCenter);
    if (clustersRef.current) {
      clustersRef.current.setSkeletonCenter(newCenter);
      if (newScrollTop !== undefined) {
        clustersRef.current.scrollTo(newScrollTop);
      }
    }
  }, []);

  // Handle visible range change from OrderBook
  const handleVisibleRangeChange = useCallback((range: { min: number; max: number }) => {
    setVisiblePriceRange(range);
  }, []);

  const priceRange = useMemo(() => {
    if (visiblePriceRange) {
      const padding = (visiblePriceRange.max - visiblePriceRange.min) * 0.01;
      return { min: visiblePriceRange.min - padding, max: visiblePriceRange.max + padding };
    }

    const bid = parseFloat(bestBid);
    const ask = parseFloat(bestAsk);
    if (bid > 0 && ask > 0) {
      const midPrice = (bid + ask) / 2;
      const range = midPrice * 0.005;
      return { min: midPrice - range, max: midPrice + range };
    }

    return null;
  }, [visiblePriceRange, bestBid, bestAsk]);

  const { layout } = CLIENT_CONFIG;
  const columnWidth = compact ? layout.clusterColumnWidth.compact : layout.clusterColumnWidth.normal;

  const maxOB = instruments.length >= 4
    ? layout.maxOrderbookWidth / 4
    : layout.maxOrderbookWidth / 2;
  const orderbookWidth = Math.min(
    maxOB,
    Math.max(layout.minOrderbookWidth, panelWidth * layout.orderbookRatio)
  );
  const remaining = panelWidth - orderbookWidth;

  const availableForChart = remaining * layout.chartRatio;
  const availableForClusters = remaining - availableForChart;

  const maxClusterColumns = getMaxClusterColumns(instruments.length);
  const visibleClusterColumns = Math.max(1, Math.min(maxClusterColumns, Math.floor(availableForClusters / columnWidth)));
  const visibleTicks = Math.max(1, Math.floor(availableForChart / layout.tickSpacing));

  const clustersWidthPx = visibleClusterColumns * columnWidth;
  const chartWidthPx = visibleTicks * layout.tickSpacing;

  return (
    <div
      ref={panelRef}
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        background: 'var(--bg-secondary)',
        borderRadius: '4px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: compact ? '4px 8px' : '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-tertiary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '6px' : '12px' }}>
          <span style={{ fontWeight: 600, fontSize: compact ? '11px' : '14px' }}>
            {instrument.symbol}
            <span style={{ fontSize: '9px', color: 'var(--accent-yellow)', marginLeft: '4px' }}>V2</span>
          </span>
          {!compact && bestBid !== '0' && bestAsk !== '0' && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--accent-green)' }}>{bestBid}</span>
              {' / '}
              <span style={{ color: 'var(--accent-red)' }}>{bestAsk}</span>
            </span>
          )}
        </div>
        <button
          onClick={() => removeInstrument(instrument.id)}
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            color: 'var(--text-secondary)',
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <LoadingOverlay symbol={instrument.symbol} />

        {/* Clusters */}
        <div style={{
          flexShrink: 0,
          width: `${clustersWidthPx}px`,
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <SyncedClustersV2
            ref={clustersRef}
            symbol={instrument.symbol}
            compact={compact}
            maxColumns={visibleClusterColumns}
            skeletonCenterPrice={skeletonCenterPrice}
          />
        </div>

        {/* TickChart */}
        <div style={{
          flexShrink: 0,
          width: `${chartWidthPx}px`,
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <TickChart
            symbol={instrument.symbol}
            priceRange={priceRange}
            compact={compact}
            maxVisibleTicks={visibleTicks}
            tickSize={tickSizeNum}
          />
        </div>

        {/* OrderBook */}
        <div
          style={{
            flex: 1,
            minWidth: `${layout.minOrderbookWidth}px`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <SyncedOrderBookV2
            ref={orderbookRef}
            symbol={instrument.symbol}
            onScroll={handleOrderBookScroll}
            onSkeletonCenterChange={handleSkeletonCenterChange}
            onVisibleRangeChange={handleVisibleRangeChange}
            compact={compact}
          />
        </div>
      </div>
    </div>
  );
});
