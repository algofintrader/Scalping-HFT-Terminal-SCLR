import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useConnectionStore } from './connection';
import { useMarketDataStore } from './marketData';
import { marketDataBuffer } from '../buffers/MarketDataBuffer';
import { CLIENT_CONFIG } from '../config';

export interface Instrument {
  id: string;
  symbol: string;
}

const SUBSCRIBE_TIMEOUT = 15000; // 15 seconds to receive data
const MAX_RETRIES = 3;

const subscribeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const retryCount = new Map<string, number>();
const subscribeErrors = new Map<string, string>();

/**
 */
function startSubscribeTimeout(symbol: string): void {
  clearSubscribeTimeout(symbol);

  const timeoutId = setTimeout(() => {
    const instrumentExists = useWorkspaceStore.getState().instruments.some(i => i.symbol === symbol);
    if (!instrumentExists) {
      console.log(`[Workspace] Subscribe timeout fired for removed instrument ${symbol}, ignoring`);
      clearSubscribeTimeout(symbol);
      return;
    }

    const bidsSize = useMarketDataStore.getState().symbols[symbol]?.orderbookV2?.bids?.size ?? 0;
    const hasData = bidsSize > 0;

    if (!hasData) {
      const count = (retryCount.get(symbol) || 0) + 1;
      retryCount.set(symbol, count);

      if (count <= MAX_RETRIES) {
        console.warn(`[Workspace] Subscribe timeout for ${symbol}, retry ${count}/${MAX_RETRIES}`);
        useConnectionStore.getState().send({ type: 'subscribe', symbol });
        startSubscribeTimeout(symbol);
      } else {
        console.error(`[Workspace] Subscribe failed for ${symbol} after ${MAX_RETRIES} retries`);
        subscribeErrors.set(symbol, 'Connection failed');
        useWorkspaceStore.getState()._triggerUpdate();
      }
    }
  }, SUBSCRIBE_TIMEOUT);

  subscribeTimeouts.set(symbol, timeoutId);
}

/**
 */
export function clearSubscribeTimeout(symbol: string): void {
  const timeoutId = subscribeTimeouts.get(symbol);
  if (timeoutId) {
    clearTimeout(timeoutId);
    subscribeTimeouts.delete(symbol);
  }
  retryCount.delete(symbol);
  subscribeErrors.delete(symbol);
}

/**
 */
export function clearAllSubscribeState(): void {
  for (const timeoutId of subscribeTimeouts.values()) {
    clearTimeout(timeoutId);
  }
  subscribeTimeouts.clear();
  retryCount.clear();
  subscribeErrors.clear();
}

/**
 */
export function getSubscribeStatus(symbol: string): {
  retryCount: number;
  maxRetries: number;
  error: string | null;
  isRetrying: boolean;
} {
  const count = retryCount.get(symbol) || 0;
  const error = subscribeErrors.get(symbol) || null;
  return {
    retryCount: count,
    maxRetries: MAX_RETRIES,
    error,
    isRetrying: count > 0 && count <= MAX_RETRIES && !error,
  };
}

/**
 */
export function manualRetrySubscribe(symbol: string): void {
  console.log(`[Workspace] Manual retry for ${symbol}`);
  retryCount.set(symbol, 0);
  subscribeErrors.delete(symbol);
  useConnectionStore.getState().send({ type: 'subscribe', symbol });
  startSubscribeTimeout(symbol);
  useWorkspaceStore.getState()._triggerUpdate();
}

interface WorkspaceState {
  instruments: Instrument[];
  _hasHydrated: boolean;
  _updateTrigger: number;  // Trigger UI update on retry/error change

  addInstrument: (symbol: string) => void;
  removeInstrument: (id: string) => void;
  removeInstrumentBySymbol: (symbol: string) => void;  // Remove without unsubscribe (for rejected subscriptions)
  resubscribeAll: () => void;
  setHasHydrated: (state: boolean) => void;
  initializeDefaults: () => void;
  loadInstruments: (instruments: Instrument[]) => void;  // Load instruments from backup
  _triggerUpdate: () => void;  // Trigger UI update on subscription status change
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      // Debug: expose store to window for testing
      if (typeof window !== 'undefined') {
        (window as any).__workspaceStore = { getState: get };
      }
      return {
      instruments: [],
      _hasHydrated: false,
      _updateTrigger: 0,

      setHasHydrated: (state: boolean) => {
        set({ _hasHydrated: state });
      },

      _triggerUpdate: () => {
        set((state) => ({ _updateTrigger: state._updateTrigger + 1 }));
      },

      addInstrument: (symbol: string) => {
        const { instruments } = get();

        if (instruments.length >= 10) return;

        if (instruments.some((i) => i.symbol === symbol)) return;

        const newInstrument: Instrument = {
          id: `${symbol}-${Date.now()}`,
          symbol,
        };

        set({ instruments: [...instruments, newInstrument] });

        useConnectionStore.getState().send({
          type: 'subscribe',
          symbol,
        });

        startSubscribeTimeout(symbol);
      },

      removeInstrument: (id: string) => {
        const { instruments } = get();
        const instrument = instruments.find((i) => i.id === id);

        if (!instrument) return;

        set({ instruments: instruments.filter((i) => i.id !== id) });

        clearSubscribeTimeout(instrument.symbol);

        useConnectionStore.getState().send({
          type: 'unsubscribe',
          symbol: instrument.symbol,
        });

        marketDataBuffer.clearSymbol(instrument.symbol);
        useMarketDataStore.getState().clearSymbol(instrument.symbol);
      },

      removeInstrumentBySymbol: (symbol: string) => {
        const { instruments } = get();
        const instrument = instruments.find((i) => i.symbol === symbol);

        if (!instrument) return;

        set({ instruments: instruments.filter((i) => i.symbol !== symbol) });

        clearSubscribeTimeout(symbol);

        marketDataBuffer.clearSymbol(symbol);
        useMarketDataStore.getState().clearSymbol(symbol);
      },

      resubscribeAll: () => {
        const { instruments } = get();
        const { send } = useConnectionStore.getState();

        for (const instrument of instruments) {
          send({
            type: 'subscribe',
            symbol: instrument.symbol,
          });
          startSubscribeTimeout(instrument.symbol);
        }
      },

      initializeDefaults: () => {
        const { instruments, addInstrument } = get();

        if (instruments.length > 0) return;

        console.log('[Workspace] First launch detected, adding default instruments');

        const defaults = CLIENT_CONFIG.workspace.defaultInstruments;
        defaults.forEach((symbol) => {
          addInstrument(symbol);
        });
      },

      loadInstruments: (instruments: Instrument[]) => {
        set({ instruments });
        const { send } = useConnectionStore.getState();
        for (const instrument of instruments) {
          send({
            type: 'subscribe',
            symbol: instrument.symbol,
          });
          startSubscribeTimeout(instrument.symbol);
        }
      },
    };
    },
    {
      name: 'sclr-workspace',
      partialize: (state) => ({
        instruments: state.instruments,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    clearAllSubscribeState();
  });
}
