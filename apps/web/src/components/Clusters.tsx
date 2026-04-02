import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMarketDataStore, selectClusters } from '../stores/marketData';
import type { ClusterCell } from '@sclr/shared';

interface Props {
  symbol: string;
  prices: string[]; // Price list from order book for synchronization
}

const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 60;

export function Clusters({ symbol, prices }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const clusters = useMarketDataStore(selectClusters(symbol));

  const matrix = useMemo(() => {
    if (!clusters || prices.length === 0) return new Map<string, Map<number, ClusterCell>>();

    const result = new Map<string, Map<number, ClusterCell>>();

    for (const price of prices) {
      result.set(price, new Map());
    }

    for (const column of clusters.columns) {
      for (const [price, cell] of Object.entries(column.cells)) {
        if (result.has(price)) {
          result.get(price)!.set(column.openTime, cell);
        }
      }
    }

    return result;
  }, [clusters, prices]);

  const virtualizer = useVirtualizer({
    count: prices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  if (!clusters || prices.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: '12px',
      }}>
        Loading...
      </div>
    );
  }

  const columns = clusters.columns.sort((a, b) => a.openTime - b.openTime); // Oldest left, newest right

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header with timestamps */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        flexShrink: 0,
      }}>
        {columns.map((col) => (
          <div
            key={col.openTime}
            style={{
              width: COLUMN_WIDTH,
              flexShrink: 0,
              padding: '4px',
              textAlign: 'center',
              fontSize: '10px',
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
        ref={parentRef}
        style={{
          flex: 1,
          overflow: 'auto',
          contain: 'strict',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: `${columns.length * COLUMN_WIDTH}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const price = prices[virtualRow.index];
            if (!price) return null;
            const rowData = matrix.get(price);

            return (
              <div
                key={price}
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
                {columns.map((col) => {
                  const cell = rowData?.get(col.openTime);
                  return (
                    <ClusterCell
                      key={col.openTime}
                      cell={cell}
                      price={price}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface CellProps {
  cell: ClusterCell | undefined;
  price: string;
}

function ClusterCell({ cell }: CellProps) {
  if (!cell) {
    return (
      <div
        style={{
          width: COLUMN_WIDTH,
          flexShrink: 0,
          borderRight: '1px solid var(--border-color)',
          borderBottom: '1px solid var(--border-color)',
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
        width: COLUMN_WIDTH,
        flexShrink: 0,
        borderRight: '1px solid var(--border-color)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
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
}

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
