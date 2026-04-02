import { create } from 'zustand';
import pako from 'pako';
import type { ClientMessage } from '@sclr/shared';
import { ServerMessageSchema, type ServerMessage } from '@sclr/shared';
import { useWorkspaceStore, clearSubscribeTimeout } from './workspace';
import { marketDataBuffer } from '../buffers/MarketDataBuffer';
// RenderLoop auto-starts on import
import '../buffers/RenderLoop';

interface ConnectionState {
  isConnected: boolean;
  socket: WebSocket | null;
  pendingMessages: ClientMessage[];  // Message queue until connected
  availableSymbols: string[];  // Server-supported symbols

  connect: () => void;
  disconnect: () => void;
  send: (message: ClientMessage) => void;
  setAvailableSymbols: (symbols: string[]) => void;
  requestResync: (symbol: string) => void;
}

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// Message queue limit during disconnect (OOM protection)
const MAX_PENDING_MESSAGES = 100;

// Reconnect backoff state
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  isConnected: false,
  socket: null,
  pendingMessages: [],
  availableSymbols: [],

  setAvailableSymbols: (symbols: string[]) => {
    set({ availableSymbols: symbols });
  },

  connect: () => {
    const { socket } = get();
    if (socket) return;

    console.log('[WS] Connecting to', WS_URL);

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[WS] Connected');
      set({ isConnected: true, socket: ws });

      // Track whether this was a reconnect (not first connection)
      const wasReconnect = reconnectAttempts > 0;

      // Reset backoff on successful connection
      reconnectAttempts = 0;

      // Send queued messages
      const { pendingMessages } = get();
      if (pendingMessages.length > 0) {
        for (const msg of pendingMessages) {
          ws.send(JSON.stringify(msg));
        }
        set({ pendingMessages: [] });
      }

      // CRITICAL: Restore subscriptions for all instruments after reconnect
      // This ensures data keeps flowing after connection drop
      if (wasReconnect) {
        console.log('[WS] Reconnect detected, resubscribing to all instruments...');
        useWorkspaceStore.getState().resubscribeAll();
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      set({ isConnected: false, socket: null });

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
      reconnectAttempts++;

      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
      setTimeout(() => {
        get().connect();
      }, delay);
    };

    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    ws.onmessage = async (event) => {
      try {
        let parsed;

        if (event.data instanceof Blob) {
          // Binary frame = gzip compressed (resync messages)
          const buffer = await event.data.arrayBuffer();
          const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
          parsed = JSON.parse(decompressed);
        } else {
          // Text frame = plain JSON (deltas, ticks, etc.)
          parsed = JSON.parse(event.data);
        }

        // Validate via Zod
        const result = ServerMessageSchema.safeParse(parsed);
        if (!result.success) {
          console.error('[WS] Invalid server message:', result.error.message);
          return;
        }

        // Write to buffer instead of updating Zustand directly
        handleServerMessage(result.data);
      } catch (error) {
        console.error('[WS] Parse error:', error);
      }
    };
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
      set({ socket: null, isConnected: false });
    }
  },

  send: (message: ClientMessage) => {
    const { socket, isConnected, pendingMessages } = get();
    if (socket && isConnected) {
      socket.send(JSON.stringify(message));
    } else {
      // FIXED: Immutable array update to avoid Zustand state mutation issues
      if (pendingMessages.length < MAX_PENDING_MESSAGES) {
        set({ pendingMessages: [...pendingMessages, message] });
      } else {
        console.warn('[WS] Pending messages limit reached, dropping message');
      }
    }
  },

  requestResync: (symbol: string) => {
    const { socket, isConnected } = get();
    if (socket && isConnected) {
      socket.send(JSON.stringify({
        type: 'request_resync',
        symbol,
      }));
    }
  },
}));

/**
 * Handle server message - writes to BUFFER, not directly to Zustand.
 * RenderLoop will flush buffer to Zustand on RAF tick.
 */
function handleServerMessage(message: ServerMessage) {
  switch (message.type) {
    case 'subscribed':
      console.log('[WS] Subscribed to', message.symbol);
      // Store available symbols from server
      useConnectionStore.getState().setAvailableSymbols(message.availableSymbols);
      break;

    // V2: Virtual Skeleton OrderBook
    case 'orderbook_snapshot_v2':
      // Clear timeout — data received successfully
      clearSubscribeTimeout(message.data.symbol);
      marketDataBuffer.queueOrderBookSnapshotV2(message.data.symbol, message.data);
      break;

    case 'orderbook_delta_v2':
      marketDataBuffer.queueOrderBookDeltaV2(message.data.symbol, message.data);
      break;

    case 'orderbook_resync_v2':
      // Clear timeout — data received successfully
      clearSubscribeTimeout(message.data.symbol);
      marketDataBuffer.queueOrderBookResyncV2(message.data.symbol, message.data);
      break;

    // V2: Clusters Virtual Skeleton
    case 'clusters_resync_v2':
      marketDataBuffer.queueClustersResyncV2(message.data.symbol, message.data);
      break;

    case 'clusters_delta_v2':
      marketDataBuffer.queueClustersDeltaV2(message.data.symbol, message.data);
      break;

    case 'ticks':
      // Queue to buffer — RenderLoop will apply to Zustand
      marketDataBuffer.queueTicks(message.data.symbol, message.data.ticks);
      break;

    case 'error':
      console.error('[WS] Server error:', message.code, message.message);
      // On UNSUPPORTED_SYMBOL error, remove instrument from workspace
      if (message.code === 'UNSUPPORTED_SYMBOL' && message.symbol) {
        const workspace = useWorkspaceStore.getState();
        const instrument = workspace.instruments.find(i => i.symbol === message.symbol);
        if (instrument) {
          console.warn(`[WS] Removing unsupported instrument: ${message.symbol}`);
          workspace.removeInstrumentBySymbol(message.symbol);
        }
      }
      break;

    default: {
      // Exhaustive check — TypeScript will error if a new type is added
      const _exhaustive: never = message;
      console.warn('[WS] Unknown message type:', _exhaustive);
    }
  }
}

// Auto-connect on load
if (typeof window !== 'undefined') {
  useConnectionStore.getState().connect();

  // Debug: export store for testing
  (window as any).__connectionStore = {
    getState: useConnectionStore.getState,
    getSocket: () => useConnectionStore.getState().socket,
    // Simulate disconnect for testing
    simulateDisconnect: () => {
      const socket = useConnectionStore.getState().socket;
      if (socket) {
        console.log('[Test] Closing WebSocket to simulate disconnect');
        socket.close();
      }
    }
  };
}
