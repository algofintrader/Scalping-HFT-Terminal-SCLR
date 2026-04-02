import { z } from 'zod';

export const TradeSideSchema = z.enum(['buy', 'sell']);
export type TradeSide = z.infer<typeof TradeSideSchema>;

export const AggregatedTickSchema = z.object({
  price: z.string(),
  quantity: z.string(),  // total volume
  side: TradeSideSchema, // direction (determined by dominant side)
  count: z.number(),     // number of trades in aggregation
  timestamp: z.number(), // aggregation timestamp
});

export type AggregatedTick = z.infer<typeof AggregatedTickSchema>;

export const TicksBatchSchema = z.object({
  symbol: z.string(),
  ticks: z.array(AggregatedTickSchema),
  timestamp: z.number(),
});

export type TicksBatch = z.infer<typeof TicksBatchSchema>;

export interface RawTick {
  symbol: string;
  price: string;
  quantity: string;
  side: TradeSide;
  tradeId: number;
  timestamp: number;
}
