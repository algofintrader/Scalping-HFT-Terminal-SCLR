import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConnectionStore } from '../stores/connection';
import { useMarketDataStore } from '../stores/marketData';
import { useWorkspaceStore, getSubscribeStatus, manualRetrySubscribe } from '../stores/workspace';
import { useTranslation } from '../i18n';

interface Props {
  symbol: string;
}

interface LoadingStatus {
  isConnected: boolean;
  isSubscribed: boolean;
  orderbookLevels: number;
  clustersColumns: number;
  ticksCount: number;
  progress: number;
  // Retry status
  retryCount: number;
  maxRetries: number;
  error: string | null;
  isRetrying: boolean;
}

function useLoadingStatus(symbol: string): LoadingStatus {
  const isConnected = useConnectionStore((state) => state.isConnected);

  const { orderbookLevels, clustersColumns, ticksCount } = useMarketDataStore(
    useShallow((state) => ({
      orderbookLevels: state.symbols[symbol]?.orderbookV2?.bids?.size ?? 0,
      clustersColumns: state.symbols[symbol]?.clusters?.columns?.length ?? 0,
      ticksCount: state.symbols[symbol]?.ticks?.length ?? 0,
    }))
  );

  useWorkspaceStore((state) => state._updateTrigger);

  const subscribeStatus = getSubscribeStatus(symbol);

  const isSubscribed = orderbookLevels > 0 || clustersColumns > 0 || ticksCount > 0;

  let progress = 0;
  if (isConnected) progress = 25;
  if (isSubscribed) progress = 50;
  if (orderbookLevels > 0) progress = 75;
  if (clustersColumns > 0) progress = 100;

  return {
    isConnected,
    isSubscribed,
    orderbookLevels,
    clustersColumns,
    ticksCount,
    progress,
    retryCount: subscribeStatus.retryCount,
    maxRetries: subscribeStatus.maxRetries,
    error: subscribeStatus.error,
    isRetrying: subscribeStatus.isRetrying,
  };
}

export function LoadingOverlay({ symbol }: Props) {
  const { t, format } = useTranslation();
  const status = useLoadingStatus(symbol);

  const handleRetry = useCallback(() => {
    manualRetrySubscribe(symbol);
  }, [symbol]);

  const isFullyLoaded =
    status.isConnected &&
    status.orderbookLevels > 0;

  if (isFullyLoaded) {
    return null;
  }

  let currentStage = t.loading.connecting;
  let stageColor = 'var(--accent-green)';

  if (status.error) {
    currentStage = t.loading.connectionFailed || 'Connection failed';
    stageColor = 'var(--accent-red, #e53935)';
  } else if (status.isRetrying) {
    currentStage = `${t.loading.retrying || 'Retrying'}... (${status.retryCount}/${status.maxRetries})`;
    stageColor = 'var(--accent-yellow, #f5a623)';
  } else if (status.isConnected && !status.isSubscribed) {
    currentStage = format(t.loading.subscribing, { symbol });
  } else if (status.isConnected && status.orderbookLevels === 0) {
    currentStage = t.loading.loadingOrderbook;
  } else if (status.isConnected && status.clustersColumns === 0) {
    currentStage = t.loading.loadingClusters;
  }

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(10, 10, 10, 0.95)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      gap: '16px',
    }}>
      {status.error ? <ErrorIcon /> : <Spinner />}

      <div style={{
        fontSize: '14px',
        fontWeight: 500,
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span>{currentStage}</span>
        {!status.error && (
          <span style={{ color: stageColor, fontFamily: 'monospace' }}>
            {status.progress}%
          </span>
        )}
      </div>

      {!status.error && (
        <div style={{
          width: '200px',
          height: '4px',
          background: 'var(--bg-tertiary)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${status.progress}%`,
            height: '100%',
            background: status.isRetrying ? 'var(--accent-yellow, #f5a623)' : 'var(--accent-green)',
            borderRadius: '2px',
            transition: 'width 0.3s ease-out',
          }} />
        </div>
      )}

      {/* Retry button on error */}
      {status.error && (
        <button
          onClick={handleRetry}
          style={{
            marginTop: '8px',
            padding: '8px 20px',
            background: 'var(--accent-green)',
            color: 'var(--bg-primary)',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
        >
          {t.loading.retry || 'Retry'}
        </button>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        fontSize: '12px',
        marginTop: '8px',
      }}>
        <StatusItem
          label={t.loading.server}
          status={status.isConnected ? 'done' : 'loading'}
          detail={status.isConnected ? t.loading.connected : t.loading.connecting}
        />
        <StatusItem
          label={t.loading.orderbook}
          status={
            status.error ? 'error' :
            status.orderbookLevels > 0 ? 'done' :
            status.isRetrying ? 'retrying' :
            (status.isConnected ? 'loading' : 'pending')
          }
          detail={
            status.error ? (t.loading.failed || 'Error') :
            status.orderbookLevels > 0 ? `${status.orderbookLevels} ${t.loading.levels}` :
            status.isRetrying ? `${t.loading.attempt || 'Attempt'} ${status.retryCount}/${status.maxRetries}` :
            t.loading.waiting
          }
        />
        <StatusItem
          label={t.loading.clusters}
          status={status.clustersColumns > 0 ? 'done' : (status.orderbookLevels > 0 ? 'loading' : 'pending')}
          detail={status.clustersColumns > 0 ? `${status.clustersColumns} ${t.loading.columns}` : t.loading.waiting}
        />
        <StatusItem
          label={t.loading.tickChart}
          status={status.ticksCount > 0 ? 'done' : (status.orderbookLevels > 0 ? 'loading' : 'pending')}
          detail={status.ticksCount > 0 ? `${status.ticksCount} ${t.loading.ticks}` : t.loading.waitingTrades}
        />
      </div>
    </div>
  );
}

interface StatusItemProps {
  label: string;
  status: 'pending' | 'loading' | 'done' | 'error' | 'retrying';
  detail: string;
}

const StatusItem = memo(function StatusItem({ label, status, detail }: StatusItemProps) {
  const iconMap: Record<typeof status, string> = {
    done: '✓',
    loading: '◎',
    pending: '○',
    error: '✕',
    retrying: '↻',
  };

  const colorMap: Record<typeof status, string> = {
    done: 'var(--accent-green)',
    loading: 'var(--accent-yellow, #f5a623)',
    pending: 'var(--text-muted)',
    error: 'var(--accent-red, #e53935)',
    retrying: 'var(--accent-yellow, #f5a623)',
  };

  const icon = iconMap[status];
  const color = colorMap[status];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: status === 'done' ? 'var(--text-secondary)' : 'var(--text-muted)',
    }}>
      <span style={{
        color,
        width: '16px',
        textAlign: 'center',
        fontSize: '14px',
        animation: status === 'retrying' ? 'spin 1s linear infinite' : undefined,
      }}>
        {icon}
      </span>
      <span style={{ width: '70px' }}>{label}</span>
      <span style={{
        color: status === 'error' ? 'var(--accent-red, #e53935)' :
               status === 'done' ? 'var(--text-muted)' : 'var(--text-secondary)',
        fontSize: '11px',
      }}>
        {detail}
      </span>
    </div>
  );
});

const Spinner = memo(function Spinner() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        animation: 'spin 1s linear infinite',
      }}
    >
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--text-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="40 60"
        opacity="0.7"
      />
    </svg>
  );
});

const ErrorIcon = memo(function ErrorIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--accent-red, #e53935)"
        strokeWidth="2"
        opacity="0.9"
      />
      <path
        d="M15 9L9 15M9 9L15 15"
        stroke="var(--accent-red, #e53935)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
});
