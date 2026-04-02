import { z } from 'zod';

/**
 */

// Binance Depth Update (WebSocket)
export const BinanceDepthUpdateSchema = z.object({
  e: z.literal('depthUpdate'),
  E: z.number(), // Event time
  T: z.number(), // Transaction time
  s: z.string(), // Symbol
  U: z.number(), // First update ID
  u: z.number(), // Final update ID
  pu: z.number(), // Previous final update ID
  b: z.array(z.tuple([z.string(), z.string()])), // Bids [price, qty]
  a: z.array(z.tuple([z.string(), z.string()])), // Asks [price, qty]
});
export type BinanceDepthUpdate = z.infer<typeof BinanceDepthUpdateSchema>;

// Binance Aggregate Trade (WebSocket)
export const BinanceAggTradeSchema = z.object({
  e: z.literal('aggTrade'),
  E: z.number(), // Event time
  s: z.string(), // Symbol
  a: z.number(), // Aggregate trade ID
  p: z.string(), // Price
  q: z.string(), // Quantity
  f: z.number(), // First trade ID
  l: z.number(), // Last trade ID
  T: z.number(), // Trade time
  m: z.boolean(), // Is buyer maker
});
export type BinanceAggTrade = z.infer<typeof BinanceAggTradeSchema>;

// Binance Book Ticker (WebSocket)
export const BinanceBookTickerSchema = z.object({
  e: z.literal('bookTicker'),
  u: z.number(), // Order book updateId
  s: z.string(), // Symbol
  b: z.string(), // Best bid price
  B: z.string(), // Best bid qty
  a: z.string(), // Best ask price
  A: z.string(), // Best ask qty
  T: z.number(), // Transaction time
  E: z.number(), // Event time
});
export type BinanceBookTicker = z.infer<typeof BinanceBookTickerSchema>;

export const BinanceWsEventSchema = z.discriminatedUnion('e', [
  BinanceDepthUpdateSchema,
  BinanceAggTradeSchema,
  BinanceBookTickerSchema,
]);
export type BinanceWsEvent = z.infer<typeof BinanceWsEventSchema>;

// Depth Snapshot (REST API)
export const BinanceDepthSnapshotSchema = z.object({
  lastUpdateId: z.number(),
  E: z.number().optional(), // Event time (may be absent)
  T: z.number().optional(), // Transaction time (may be absent)
  bids: z.array(z.tuple([z.string(), z.string()])),
  asks: z.array(z.tuple([z.string(), z.string()])),
});
export type BinanceDepthSnapshot = z.infer<typeof BinanceDepthSnapshotSchema>;

// Exchange Info Symbol (REST API)
export const BinanceSymbolInfoSchema = z.object({
  symbol: z.string(),
  pair: z.string().optional(),
  contractType: z.string().optional(),
  deliveryDate: z.number().optional(),
  onboardDate: z.number().optional(),
  status: z.string(),
  maintMarginPercent: z.string().optional(),
  requiredMarginPercent: z.string().optional(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  marginAsset: z.string().optional(),
  pricePrecision: z.number(),
  quantityPrecision: z.number(),
  baseAssetPrecision: z.number().optional(),
  quotePrecision: z.number().optional(),
  filters: z.array(z.record(z.unknown())),
  orderTypes: z.array(z.string()).optional(),
  timeInForce: z.array(z.string()).optional(),
});
export type BinanceSymbolInfo = z.infer<typeof BinanceSymbolInfoSchema>;

// Exchange Info Response (REST API)
export const BinanceExchangeInfoSchema = z.object({
  timezone: z.string().optional(),
  serverTime: z.number().optional(),
  rateLimits: z.array(z.record(z.unknown())).optional(),
  exchangeFilters: z.array(z.record(z.unknown())).optional(),
  symbols: z.array(BinanceSymbolInfoSchema),
});
export type BinanceExchangeInfo = z.infer<typeof BinanceExchangeInfoSchema>;

// 24hr Ticker (REST API)
export const BinanceTickerSchema = z.object({
  symbol: z.string(),
  priceChange: z.string().optional(),
  priceChangePercent: z.string(),
  weightedAvgPrice: z.string().optional(),
  lastPrice: z.string().optional(),
  lastQty: z.string().optional(),
  openPrice: z.string().optional(),
  highPrice: z.string().optional(),
  lowPrice: z.string().optional(),
  volume: z.string().optional(),
  quoteVolume: z.string(),
  openTime: z.number().optional(),
  closeTime: z.number().optional(),
  firstId: z.number().optional(),
  lastId: z.number().optional(),
  count: z.number().optional(),
});
export type BinanceTicker = z.infer<typeof BinanceTickerSchema>;

/**
 */
export function parseBinanceWsEvent(data: unknown): BinanceWsEvent | null {
  const result = BinanceWsEventSchema.safeParse(data);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 */
export function isDepthUpdate(event: BinanceWsEvent): event is BinanceDepthUpdate {
  return event.e === 'depthUpdate';
}

export function isAggTrade(event: BinanceWsEvent): event is BinanceAggTrade {
  return event.e === 'aggTrade';
}

export function isBookTicker(event: BinanceWsEvent): event is BinanceBookTicker {
  return event.e === 'bookTicker';
}
