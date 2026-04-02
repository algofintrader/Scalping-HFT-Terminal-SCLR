import type { ServerWebSocket } from 'bun';
import {
  ClientMessageSchema,
  ResyncRequestSchema,
  type ServerMessage,
  type SubscribedMessage,
  type ErrorMessage,
  type SupportedSymbol,
} from '@sclr/shared';
import { orderBookService } from '../services/OrderBookService';
import { tickAggregator } from '../services/TickAggregator';
import { clusterService } from '../services/ClusterService';
import { viewportManager } from '../services/ViewportManager';
import { symbolManager } from '../services/SymbolManager';

interface WebSocketData {
  clientId: string;
  subscriptions: Set<string>;
}

const clientsById = new Map<string, ServerWebSocket<WebSocketData>>();
const subscriptionsBySymbol = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

let clientIdCounter = 0;

function generateClientId(): string {
  return `client_${Date.now()}_${++clientIdCounter}`;
}

/**
 */
function safeSend(ws: ServerWebSocket<WebSocketData>, message: any): boolean {
  try {
    const sent = ws.send(JSON.stringify(message));
    if (sent === 0) {
      console.warn(`[WS] Message dropped for ${ws.data.clientId} (backpressure)`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[WS] Send failed for ${ws.data.clientId}:`, error);
    cleanupDeadClient(ws);
    return false;
  }
}

/**
 */
function safeSendCompressed(ws: ServerWebSocket<WebSocketData>, message: any): boolean {
  try {
    const json = JSON.stringify(message);
    const compressed = Bun.gzipSync(json);
    console.log(`[WS] Compressed ${ws.data.clientId}: ${json.length}B → ${compressed.length}B (${(json.length / compressed.length).toFixed(1)}x)`);
    const sent = ws.send(compressed);  // binary frame
    if (sent === 0) {
      console.warn(`[WS] Compressed message dropped for ${ws.data.clientId} (backpressure)`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[WS] Compressed send failed for ${ws.data.clientId}:`, error);
    cleanupDeadClient(ws);
    return false;
  }
}

/**
 */
function cleanupDeadClient(ws: ServerWebSocket<WebSocketData>): void {
  const clientId = ws.data.clientId;

  clientsById.delete(clientId);

  viewportManager.unregisterAll(clientId);

  for (const symbol of ws.data.subscriptions) {
    const subscribers = subscriptionsBySymbol.get(symbol);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        subscriptionsBySymbol.delete(symbol);
      }
    }
  }

  console.log(`[WS] Cleaned up dead client ${clientId}`);
}

export function sendToClient(clientId: string, message: any): void {
  const ws = clientsById.get(clientId);
  if (ws) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[WS] Failed to send to ${clientId}:`, error);
      cleanupDeadClient(ws);
    }
  }
}

orderBookService.setBroadcastCallback(sendToClient);

clusterService.setBroadcastCallback(sendToClient);

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const clientId = generateClientId();
    ws.data.clientId = clientId;
    ws.data.subscriptions = new Set();

    clientsById.set(clientId, ws);

    console.log(`[WS] Client ${clientId} connected`);
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const raw = typeof message === 'string' ? message : message.toString();
      const parsed = JSON.parse(raw);
      console.log(`[WS] Received from ${ws.data.clientId}:`, parsed.type, parsed.symbol || '');
      const result = ClientMessageSchema.safeParse(parsed);

      if (!result.success) {
        if (parsed.type === 'request_resync') {
          handleResyncRequest(ws, parsed);
          return;
        }

        sendError(ws, 'INVALID_MESSAGE', 'Invalid message format');
        return;
      }

      const msg = result.data;

      switch (msg.type) {
        case 'subscribe':
          handleSubscribe(ws, msg.symbol).catch(err => {
            console.error(`[WS] Subscribe handler error for ${msg.symbol}:`, err);
            safeSend(ws, {
              type: 'error',
              code: 'SUBSCRIBE_FAILED',
              message: err instanceof Error ? err.message : 'Subscribe failed',
            });
          });
          break;
        case 'unsubscribe':
          handleUnsubscribe(ws, msg.symbol);
          break;
      }
    } catch (error) {
      sendError(ws, 'PARSE_ERROR', 'Failed to parse message');
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    const clientId = ws.data.clientId;

    clientsById.delete(clientId);

    viewportManager.unregisterAll(clientId);

    for (const symbol of ws.data.subscriptions) {
      const subscribers = subscriptionsBySymbol.get(symbol);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          subscriptionsBySymbol.delete(symbol);
        }
      }
    }

    console.log(`[WS] Client ${clientId} disconnected`);
  },
};

/**
 */
function sendResyncData(ws: ServerWebSocket<WebSocketData>, symbol: SupportedSymbol): void {
  const clientId = ws.data.clientId;

  const midPrice = orderBookService.getMidPrice(symbol);

  viewportManager.register(clientId, symbol, midPrice);

  const orderbookResyncV2 = orderBookService.getResyncV2(symbol, 'client_request');
  if (orderbookResyncV2) {
    console.log(`[WS] Sending orderbook_resync_v2 to ${clientId}: midPrice=${orderbookResyncV2.midPrice}, bids=${orderbookResyncV2.bids.length}, asks=${orderbookResyncV2.asks.length}`);
    if (!safeSendCompressed(ws, { type: 'orderbook_resync_v2', data: orderbookResyncV2 })) return;
  }

  const clustersResyncV2 = clusterService.getResyncV2(symbol);
  if (clustersResyncV2) {
    console.log(`[WS] Sending clusters_resync_v2 to ${clientId}: ${clustersResyncV2.columns.length} columns`);
    viewportManager.updateClustersRevision(clientId, symbol, clustersResyncV2.revision);
    safeSendCompressed(ws, { type: 'clusters_resync_v2', data: clustersResyncV2 });
  } else {
    console.log(`[WS] No clusters resync for ${clientId}`);
  }
}

async function handleSubscribe(ws: ServerWebSocket<WebSocketData>, symbol: string) {
  if (!symbolManager.isSupported(symbol)) {
    sendError(ws, 'UNSUPPORTED_SYMBOL', `Symbol ${symbol} is not supported`, symbol);
    return;
  }

  const typedSymbol = symbol as SupportedSymbol;
  const clientId = ws.data.clientId;

  ws.data.subscriptions.add(symbol);

  const isFirstSubscriber = !subscriptionsBySymbol.has(symbol) || subscriptionsBySymbol.get(symbol)!.size === 0;

  if (!subscriptionsBySymbol.has(symbol)) {
    subscriptionsBySymbol.set(symbol, new Set());
  }
  subscriptionsBySymbol.get(symbol)!.add(ws);

  const isDataReady = orderBookService.isReady(typedSymbol);

  if (isFirstSubscriber && !isDataReady) {
    console.log(`[WS] First subscriber for ${symbol}, starting async subscribe...`);

    const response: SubscribedMessage = {
      type: 'subscribed',
      symbol,
      availableSymbols: [...symbolManager.getSymbols()],
    };
    if (!safeSend(ws, response)) return;

    console.log(`[WS] Client ${clientId} subscribed to ${symbol} (data pending)`);

    orderBookService.subscribe(typedSymbol)
      .then(() => {
        if (!ws.data.subscriptions.has(symbol)) {
          console.log(`[WS] Client ${clientId} unsubscribed from ${symbol} while waiting for data`);
          return;
        }

        tickAggregator.subscribe(typedSymbol);
        if (!clusterService.isSubscribed(typedSymbol)) {
          clusterService.subscribe(typedSymbol);
          console.log(`[WS] Clusters subscribed for ${symbol}`);
        }

        console.log(`[WS] Data ready for ${symbol}, sending resync to ${clientId}`);
        sendResyncData(ws, typedSymbol);
      })
      .catch(err => {
        console.error(`[WS] Async subscribe failed for ${symbol}:`, err);
        ws.data.subscriptions.delete(symbol);
        subscriptionsBySymbol.get(symbol)?.delete(ws);
        safeSend(ws, {
          type: 'error',
          code: 'SUBSCRIBE_FAILED',
          symbol,
          message: err instanceof Error ? err.message : 'Subscribe failed',
        });
      });

    return; // DON'T AWAIT - other subscriptions can be processed in parallel
  }

  if (isFirstSubscriber) {
    console.log(`[WS] First subscriber for ${symbol}, data already ready from background`);
    tickAggregator.subscribe(typedSymbol);
    if (!clusterService.isSubscribed(typedSymbol)) {
      clusterService.subscribe(typedSymbol);
      console.log(`[WS] Clusters subscribed for ${symbol}`);
    }
  }

  const response: SubscribedMessage = {
    type: 'subscribed',
    symbol,
    availableSymbols: [...symbolManager.getSymbols()],
  };
  if (!safeSend(ws, response)) return; // Client dead

  console.log(`[WS] Client ${clientId} subscribed to ${symbol}`);

  sendResyncData(ws, typedSymbol);
}

function handleUnsubscribe(ws: ServerWebSocket<WebSocketData>, symbol: string) {
  const clientId = ws.data.clientId;
  const typedSymbol = symbol as SupportedSymbol;

  ws.data.subscriptions.delete(symbol);

  viewportManager.unregister(clientId, typedSymbol);

  const subscribers = subscriptionsBySymbol.get(symbol);

  if (subscribers) {
    subscribers.delete(ws);

    if (subscribers.size === 0) {
      subscriptionsBySymbol.delete(symbol);
    }
  }

  console.log(`[WS] Client ${clientId} unsubscribed from ${symbol}`);
}


function handleResyncRequest(ws: ServerWebSocket<WebSocketData>, message: unknown) {
  const clientId = ws.data.clientId;

  const result = ResyncRequestSchema.safeParse(message);
  if (!result.success) {
    sendError(ws, 'INVALID_MESSAGE', 'Invalid resync request format');
    return;
  }

  const { symbol } = result.data;

  if (!symbolManager.isSupported(symbol)) {
    sendError(ws, 'UNSUPPORTED_SYMBOL', `Symbol ${symbol} is not supported`, symbol);
    return;
  }

  const typedSymbol = symbol as SupportedSymbol;
  const viewport = viewportManager.get(clientId, typedSymbol);

  if (!viewport) {
    console.log(`[Resync] No viewport found for ${clientId}:${symbol}`);
    return;
  }

  const orderbookResyncV2 = orderBookService.getResyncV2(typedSymbol, 'client_request');
  if (orderbookResyncV2) {
    viewportManager.updateOrderBookRevision(clientId, typedSymbol, orderbookResyncV2.revision);
    if (!safeSendCompressed(ws, { type: 'orderbook_resync_v2', data: orderbookResyncV2 })) return;
  }

  const clustersResyncV2 = clusterService.getResyncV2(typedSymbol);
  if (clustersResyncV2) {
    viewportManager.updateClustersRevision(clientId, typedSymbol, clustersResyncV2.revision);
    safeSendCompressed(ws, { type: 'clusters_resync_v2', data: clustersResyncV2 });
  }
}

function sendError(ws: ServerWebSocket<WebSocketData>, code: string, message: string, symbol?: string): void {
  const error: ErrorMessage = { type: 'error', code, message, symbol };
  safeSend(ws, error);
}

export function broadcast(symbol: string, message: ServerMessage) {
  const subscribers = subscriptionsBySymbol.get(symbol);
  if (!subscribers) return;

  const data = JSON.stringify(message);
  const failedClients: ServerWebSocket<WebSocketData>[] = [];

  for (const ws of subscribers) {
    try {
      ws.send(data);
    } catch (error) {
      console.error(`[WS] Broadcast failed for ${ws.data.clientId}:`, error);
      failedClients.push(ws);
    }
  }

  // Remove failed clients
  for (const ws of failedClients) {
    subscribers.delete(ws);
    clientsById.delete(ws.data.clientId);
    viewportManager.unregisterAll(ws.data.clientId);
  }
}

export function getSubscriberCount(symbol: string): number {
  return subscriptionsBySymbol.get(symbol)?.size ?? 0;
}

/**
 */
export function closeAllClients(): void {
  console.log(`[WS] Closing ${clientsById.size} client connections...`);
  for (const ws of clientsById.values()) {
    try {
      ws.close(1001, 'Server shutdown');
    } catch (error) {
    }
  }
  clientsById.clear();
  subscriptionsBySymbol.clear();
}
