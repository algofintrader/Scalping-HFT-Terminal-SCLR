// Types
export * from './types';

// Constants
export const SUPPORTED_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'DOTUSDT',
  'MATICUSDT',
  'LINKUSDT',
  'LTCUSDT',
  'ATOMUSDT',
  'UNIUSDT',
  'ETCUSDT',
  'XLMUSDT',
  'APTUSDT',
  'FILUSDT',
  'ARBUSDT',
  'OPUSDT',
] as const;

export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

// Intervals
export const CLUSTER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const ORDERBOOK_UPDATE_INTERVAL_MS = 50; // 50ms order book update interval
export const TICK_AGGREGATION_INTERVAL_MS = 40; // 40ms tick aggregation interval

// WebSocket
export const WS_RECONNECT_DELAY_MS = 1000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
