/**
 * SyncedClustersV2 - Virtual Skeleton Architecture
 *
 */

import { useRef, useMemo, forwardRef, useImperativeHandle, memo, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMarketDataStore, selectOrderBookV2, selectClustersV2 } from '../stores/marketData';
import { ORDERBOOK_CONFIG_V2 } from '@sclr/shared';
import type { ClusterCell } from '@sclr/shared';

interface Props {
  symbol: string;
  compact?: boolean;
  maxColumns?: number;
  /** Skeleton center, synced with OrderBook */
  skeletonCenterPrice?: number;
}

export interface SyncedClustersV2Ref {
  scrollTo: (scrollTop: number) => void;
  setSkeletonCenter: (price: number) => void;
}

const { VIRTUAL_ROWS, CENTER_INDEX } = ORDERBOOK_CONFIG_V2;
const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 50;
const DEFAULT_MAX_COLUMNS = 6;
const CLUSTER_INTERVAL_MS = 5 * 60 * 1000;
export const CLUSTER_HEADER_HEIGHT = 25;

export const SyncedClustersV2 = forwardRef<SyncedClustersV2Ref, Props>(
  function SyncedClustersV2({ symbol, compact = false, maxColumns = DEFAULT_MAX_COLUMNS, skeletonCenterPrice: externalCenter }, ref) {
    const visibleColumns = Math.min(maxColumns, DEFAULT_MAX_COLUMNS);
    const columnWidth = compact ? 40 : COLUMN_WIDTH;
    const scrollRef = useRef<HTMLDivElement>(null);
    const totalWidth = visibleColumns * columnWidth;

    // V2 OrderBook state
    const orderbookV2 = useMarketDataStore(selectOrderBookV2(symbol));
    const serverMidPrice = orderbookV2?.midPrice ?? '0';
    const tickSize = orderbookV2?.tickSize ?? '0.01';
    const pricePrecision = orderbookV2?.pricePrecision ?? 2;

    const tickSizeNum = parseFloat(tickSize);
    const serverMidPriceNum = parseFloat(serverMidPrice);

    const [localSkeletonCenter, setLocalSkeletonCenter] = useState<number>(0);
    const skeletonCenterPrice = externalCenter ?? localSkeletonCenter;

    useEffect(() => {
      if (serverMidPriceNum > 0 && localSkeletonCenter === 0 && !externalCenter) {
        setLocalSkeletonCenter(serverMidPriceNum);
      }
    }, [serverMidPriceNum, localSkeletonCenter, externalCenter]);

    const prices = useMemo(() => {
      if (skeletonCenterPrice === 0 || tickSizeNum === 0) return [];

      const result: string[] = [];
      for (let i = 0; i < VIRTUAL_ROWS; i++) {
        const priceNum = skeletonCenterPrice + (CENTER_INDEX - i) * tickSizeNum;
        result.push(priceNum.toFixed(pricePrecision));
      }
      return result;
    }, [skeletonCenterPrice, tickSizeNum, pricePrecision]);

    const clustersV2 = useMarketDataStore(selectClustersV2(symbol));
    const clustersRevision = clustersV2?.revision ?? 0;
    const latestOpenTime = clustersV2?.latestOpenTime ?? 0;

    const priceIndex = clustersV2?.priceIndex;

    const clusterColumns = useMemo(() => {
      let latestTime: number;
      if (latestOpenTime > 0) {
        latestTime = latestOpenTime;
      } else {
        const now = Date.now();
        latestTime = Math.floor(now / CLUSTER_INTERVAL_MS) * CLUSTER_INTERVAL_MS;
      }

      const columns: Array<{ openTime: number; isPlaceholder?: boolean }> = [];

      for (let i = DEFAULT_MAX_COLUMNS - 1; i >= 0; i--) {
        const targetTime = latestTime - i * CLUSTER_INTERVAL_MS;
        columns.push({ openTime: targetTime });
      }

      return columns;
    }, [latestOpenTime, clustersRevision]);

    const clusterMatrix = priceIndex ?? new Map<string, Map<number, ClusterCell>>();

    const overscanCount = compact ? 10 : 20;

    const virtualizer = useVirtualizer({
      count: VIRTUAL_ROWS,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: overscanCount,
    });

    useImperativeHandle(ref, () => ({
      scrollTo: (scrollTop: number) => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollTop;
        }
      },
      setSkeletonCenter: (price: number) => {
        setLocalSkeletonCenter(price);
      },
    }), []);

    if (prices.length === 0) {
      return (
        <div style={{
          width: `${totalWidth}px`,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            height: `${CLUSTER_HEADER_HEIGHT}px`,
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
          }} />
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: compact ? '9px' : '11px',
            flexDirection: 'column',
            gap: '4px',
          }}>
            <Spinner />
          </div>
        </div>
      );
    }

    const displayColumns = clusterColumns.slice(-visibleColumns);

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Column headers */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: totalWidth,
          height: CLUSTER_HEADER_HEIGHT,
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          zIndex: 10,
        }}>
          {displayColumns.map((col) => (
            <div
              key={col.openTime}
              style={{
                width: columnWidth,
                flexShrink: 0,
                padding: compact ? '2px' : '4px',
                textAlign: 'center',
                fontSize: compact ? '8px' : '10px',
                color: 'var(--text-secondary)',
                borderRight: '1px solid var(--border-color)',
              }}
            >
              {formatTime(col.openTime)}
            </div>
          ))}
        </div>

        {/* Data body */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflow: 'hidden',
            contain: 'strict',
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: `${totalWidth}px`,
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const price = prices[virtualRow.index];
              if (!price) return null;

              const rowData = clusterMatrix.get(price);

              return (
                <ClusterRow
                  key={virtualRow.index}
                  price={price}
                  rowData={rowData}
                  clusterColumns={displayColumns}
                  virtualRow={virtualRow}
                  columnWidth={columnWidth}
                  compact={compact}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

interface RowProps {
  price: string;
  rowData: Map<number, ClusterCell> | undefined;
  clusterColumns: Array<{ openTime: number; isPlaceholder?: boolean }>;
  virtualRow: { index: number; size: number; start: number };
  columnWidth: number;
  compact: boolean;
}

const ClusterRow = memo(function ClusterRow({ price, rowData, clusterColumns, virtualRow, columnWidth, compact }: RowProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        display: 'flex',
      }}
    >
      {clusterColumns.map((col) => {
        const cell = rowData?.get(col.openTime);
        return (
          <ClusterCellView key={col.openTime} cell={cell} columnWidth={columnWidth} compact={compact} />
        );
      })}
    </div>
  );
});

interface CellProps {
  cell: ClusterCell | undefined;
  columnWidth: number;
  compact: boolean;
}

const ClusterCellView = memo(function ClusterCellView({ cell, columnWidth, compact }: CellProps) {
  const borderRight = '1px solid var(--border-color)';

  if (!cell) {
    return (
      <div
        style={{
          width: columnWidth,
          flexShrink: 0,
          borderRight,
        }}
      />
    );
  }

  const buyVol = parseFloat(cell.buyVolume);
  const sellVol = parseFloat(cell.sellVolume);
  const totalVol = buyVol + sellVol;
  const netVol = buyVol - sellVol;

  const isBullish = netVol > 0;
  const intensity = Math.min(Math.abs(netVol) / Math.max(totalVol, 1), 1);

  return (
    <div
      style={{
        width: columnWidth,
        flexShrink: 0,
        borderRight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: compact ? '8px' : '10px',
        fontFamily: 'monospace',
        color: isBullish ? 'var(--accent-green)' : 'var(--accent-red)',
        background: isBullish
          ? `rgba(0, 200, 83, ${intensity * 0.3})`
          : `rgba(255, 23, 68, ${intensity * 0.3})`,
      }}
    >
      {totalVol > 0 ? formatVolume(totalVol) : ''}
    </div>
  );
});

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatVolume(vol: number): string {
  if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
  if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
  if (vol >= 1) return vol.toFixed(0);
  return vol.toFixed(2);
}

function Spinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <style>
        {`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
      </style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="40 60"
        opacity="0.5"
      />
    </svg>
  );
}
