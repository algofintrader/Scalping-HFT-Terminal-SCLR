import { z } from 'zod';

export interface PriceLevel {
  price: string;
  quantity: string;
  side: 'bid' | 'ask' | 'empty';
}

export const ResyncRequestSchema = z.object({
  symbol: z.string(),
});

export type ResyncRequest = z.infer<typeof ResyncRequestSchema>;

export const ORDERBOOK_CONFIG = {
  INITIAL_RANGE_PERCENT: 0.02,  // ±2% (was 1%)

  EXPAND_TICKS: 100,

  DEFAULT_VIEWPORT_SIZE: 600,  // was 500

  MAX_BUFFER_SIZE: 1800,  // was 1500

  DELTA_BROADCAST_INTERVAL_MS: 100,

  VIEWPORT_SHIFT_SIZE: 400,  // was 300

  VIEWPORT_PREFETCH_THRESHOLD: 0.4,  // was 0.3
};

/**
 */
export const ORDERBOOK_CONFIG_V2 = {
  VIRTUAL_ROWS: 5000,

  CENTER_INDEX: 2500,

  EDGE_THRESHOLD: 0.2,

  SHIFT_TICKS: 500,

  DELTA_BROADCAST_INTERVAL_MS: 100,
};

/**
 */
export const OrderBookSnapshotV2Schema = z.object({
  symbol: z.string(),
  revision: z.number(),
  midPrice: z.string(),           // mid-price for skeleton centering
  bestBid: z.string(),
  bestAsk: z.string(),
  tickSize: z.string(),           // minimum price step
  pricePrecision: z.number(),     // decimal places count
  timestamp: z.number(),
});

export type OrderBookSnapshotV2 = z.infer<typeof OrderBookSnapshotV2Schema>;

/**
 */
export const OrderBookDeltaV2Schema = z.object({
  symbol: z.string(),
  revision: z.number(),
  prevRevision: z.number(),
  bids: z.array(z.tuple([z.string(), z.string()])),  // [price, qty][]
  asks: z.array(z.tuple([z.string(), z.string()])),  // [price, qty][]
  bestBid: z.string(),
  bestAsk: z.string(),
  timestamp: z.number(),
});

export type OrderBookDeltaV2 = z.infer<typeof OrderBookDeltaV2Schema>;

/**
 */
export const OrderBookResyncV2Schema = z.object({
  symbol: z.string(),
  revision: z.number(),
  reason: z.enum(['binance_gap', 'server_restart', 'client_request']),
  midPrice: z.string(),
  bestBid: z.string(),
  bestAsk: z.string(),
  tickSize: z.string(),
  pricePrecision: z.number(),
  bids: z.array(z.tuple([z.string(), z.string()])),  // [price, qty][]
  asks: z.array(z.tuple([z.string(), z.string()])),  // [price, qty][]
  timestamp: z.number(),
});

export type OrderBookResyncV2 = z.infer<typeof OrderBookResyncV2Schema>;
