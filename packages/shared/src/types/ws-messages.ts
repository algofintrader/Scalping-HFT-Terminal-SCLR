import { z } from 'zod';
import {
  OrderBookSnapshotV2Schema,
  OrderBookDeltaV2Schema,
  OrderBookResyncV2Schema,
} from './orderbook';
import {
  ClustersResyncV2Schema,
  ClustersDeltaV2Schema,
} from './clusters';
import { TicksBatchSchema } from './ticks';


export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  symbol: z.string(),
});

export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>;

export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  symbol: z.string(),
});

export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;


// === V2: Virtual Skeleton Architecture ===

export const OrderBookSnapshotV2MessageSchema = z.object({
  type: z.literal('orderbook_snapshot_v2'),
  data: OrderBookSnapshotV2Schema,
});

export const OrderBookDeltaV2MessageSchema = z.object({
  type: z.literal('orderbook_delta_v2'),
  data: OrderBookDeltaV2Schema,
});

export const OrderBookResyncV2MessageSchema = z.object({
  type: z.literal('orderbook_resync_v2'),
  data: OrderBookResyncV2Schema,
});

// === V2: Clusters Virtual Skeleton Architecture ===

export const ClustersResyncV2MessageSchema = z.object({
  type: z.literal('clusters_resync_v2'),
  data: ClustersResyncV2Schema,
});

export const ClustersDeltaV2MessageSchema = z.object({
  type: z.literal('clusters_delta_v2'),
  data: ClustersDeltaV2Schema,
});

export const TicksMessageSchema = z.object({
  type: z.literal('ticks'),
  data: TicksBatchSchema,
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  symbol: z.string().optional(),
});

export const SubscribedMessageSchema = z.object({
  type: z.literal('subscribed'),
  symbol: z.string(),
  availableSymbols: z.array(z.string()),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  OrderBookSnapshotV2MessageSchema,
  OrderBookDeltaV2MessageSchema,
  OrderBookResyncV2MessageSchema,
  ClustersResyncV2MessageSchema,
  ClustersDeltaV2MessageSchema,
  TicksMessageSchema,
  ErrorMessageSchema,
  SubscribedMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type OrderBookSnapshotV2Message = z.infer<typeof OrderBookSnapshotV2MessageSchema>;
export type OrderBookDeltaV2Message = z.infer<typeof OrderBookDeltaV2MessageSchema>;
export type OrderBookResyncV2Message = z.infer<typeof OrderBookResyncV2MessageSchema>;
export type ClustersResyncV2Message = z.infer<typeof ClustersResyncV2MessageSchema>;
export type ClustersDeltaV2Message = z.infer<typeof ClustersDeltaV2MessageSchema>;
export type TicksMessage = z.infer<typeof TicksMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type SubscribedMessage = z.infer<typeof SubscribedMessageSchema>;
