/**
 * Server Configuration
 * Loads settings from environment variables with sensible defaults.
 */

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178,http://localhost:5179,http://localhost:3000').split(','),

  // Binance API
  binance: {
    wsUrl: process.env.BINANCE_WS_URL || 'wss://fstream.binance.com/ws',
    restUrl: process.env.BINANCE_REST_URL || 'https://fapi.binance.com',
    // Delay before first snapshot (accumulate WS events)
    initialDelayMs: 500,
    // Retry delay after resync failure
    resyncRetryDelayMs: 5000,
    // Depth snapshot limit
    depthSnapshotLimit: 1000,
  },

  // Symbol management
  symbols: {
    topCount: parseInt(process.env.TOP_SYMBOLS_COUNT || '20', 10),
    refreshIntervalMs: parseInt(process.env.SYMBOL_REFRESH_INTERVAL_MS || '3600000', 10),
  },

  // WebSocket reconnect
  ws: {
    maxReconnectAttempts: parseInt(process.env.WS_MAX_RECONNECT_ATTEMPTS || '10', 10),
    initialReconnectDelayMs: parseInt(process.env.WS_INITIAL_RECONNECT_DELAY_MS || '1000', 10),
    maxReconnectDelayMs: parseInt(process.env.WS_MAX_RECONNECT_DELAY_MS || '30000', 10),
  },

  // OrderBook constants
  orderbook: {
    // Initial range from mid-price (+-1%)
    initialRangePercent: 0.01,
    // Ticks to expand when price goes out of bounds
    expandTicks: 100,
    // Default viewport size (number of levels)
    defaultViewportSize: 200,
    // Delta broadcast interval to clients (ms)
    deltaBroadcastIntervalMs: 100,
    // Sliding window: levels to shift at once
    viewportShiftSize: 100,
    // Sliding window: edge proximity % to trigger pre-fetch
    viewportPrefetchThreshold: 0.8,
    // Max changes per broadcast (backpressure)
    maxChangesPerBroadcast: 500,
    // Max pending deltas before trim
    maxPendingDeltas: 1000,
    // Sanity check: don't expand if price is far from mid
    maxPriceDeviationPercent: 0.1,
  },

  // Clusters constants
  clusters: {
    // Column interval (5 minutes)
    intervalMs: 5 * 60 * 1000,
    // Max columns (30 min = 6 columns)
    maxColumns: 6,
    // Broadcast interval (ms)
    broadcastIntervalMs: 100,
  },

  // Ticks aggregation
  ticks: {
    // Aggregation interval (ms)
    aggregationIntervalMs: 100,
    // Max ticks in buffer
    maxBufferSize: 1000,
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

// Freeze config to prevent accidental mutations
Object.freeze(config);
Object.freeze(config.binance);
Object.freeze(config.symbols);
Object.freeze(config.ws);
Object.freeze(config.orderbook);
Object.freeze(config.clusters);
Object.freeze(config.ticks);
