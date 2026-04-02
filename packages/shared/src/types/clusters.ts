import { z } from 'zod';

export const ClusterCellSchema = z.object({
  price: z.string(),
  buyVolume: z.string(),  // buy volume
  sellVolume: z.string(), // sell volume
});

export type ClusterCell = z.infer<typeof ClusterCellSchema>;

export const ClusterColumnSchema = z.object({
  openTime: z.number(),  // period open time (ms timestamp)
  cells: z.record(z.string(), ClusterCellSchema), // price -> cell
});

export type ClusterColumn = z.infer<typeof ClusterColumnSchema>;

export const ClustersResyncV2Schema = z.object({
  symbol: z.string(),
  interval: z.number(), // interval in minutes (5)
  tickSize: z.string(),
  pricePrecision: z.number(),
  revision: z.number(),
  columns: z.array(z.object({
    openTime: z.number(),
    cells: z.record(z.string(), ClusterCellSchema), // price -> cell
  })),
  timestamp: z.number(),
});

export type ClustersResyncV2 = z.infer<typeof ClustersResyncV2Schema>;

export const ClustersDeltaV2Schema = z.object({
  symbol: z.string(),
  openTime: z.number(), // open time of the updated column
  revision: z.number(),
  prevRevision: z.number(),
  updates: z.record(z.string(), ClusterCellSchema), // price -> cell
  timestamp: z.number(),
});

export type ClustersDeltaV2 = z.infer<typeof ClustersDeltaV2Schema>;
