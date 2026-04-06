/**
 * Client Configuration
 */

export const CLIENT_CONFIG = {
  autoscroll: {
    // Upper threshold: auto-scroll when bestAsk enters top 20% of viewport
    upperThresholdPercent: 0.80,
    // Lower threshold: auto-scroll when bestBid enters bottom 20% of viewport
    lowerThresholdPercent: 0.20,
  },

  orderbook: {
    rowHeight: 20,
    compactThreshold: 300,
    overscanNormal: 20,
    overscanCompact: 10,
    scrollDebounceMs: 200,
  },

  tickChart: {
    targetFps: 30,
    minWidth: 40,
    // Min USD volume to show bubble with text label
    bubbleTextMinUsd: 50,
    bubblePadding: 4,
    // Min radius for small trades (< bubbleTextMinUsd)
    bubbleMinRadius: 2,
  },

  clusters: {
    minWidth: 60,
  },

  layout: {
    // Minimum widths (px) — floor for compression
    minOrderbookWidth: 80,
    maxOrderbookWidth: 180,
    minChartWidth: 30,
    minClustersWidth: 40,
    clusterColumnWidth: { normal: 50, compact: 40 },
    tickSpacing: 15,
    // Proportion of remaining space
    orderbookRatio: 0.5,     // Orderbook takes 50% of panel (capped at maxOrderbookWidth)
    chartRatio: 0.4,         // Chart takes 40% of remainder
  },

  workspace: {
    maxInstruments: 10,
    compactModeThreshold: 5,
    defaultInstruments: [
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'XRPUSDT',
      'DOGEUSDT',
      'BNBUSDT',
    ] as const,
  },

  storage: {
    workspace: 'sclr-workspace',
    uiPreferences: 'sclr-ui-preferences',
    auth: 'sclr-auth',
  },

  auth: {
    apiBaseUrl: import.meta.env.DEV ? 'http://localhost:3001' : '/api',
    guestSyncDebounceMs: 2000,
  },
} as const;

// TypeScript types
export type ClientConfig = typeof CLIENT_CONFIG;
