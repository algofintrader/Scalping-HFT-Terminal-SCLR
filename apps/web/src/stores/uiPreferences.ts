import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLIENT_CONFIG } from '../config';

interface UIPreferencesState {
  autoScrollEnabled: boolean;

  // Hydration flag
  _hasHydrated: boolean;

  // Actions
  setAutoScrollEnabled: (enabled: boolean) => void;
  toggleAutoScroll: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useUIPreferencesStore = create<UIPreferencesState>()(
  persist(
    (set, get) => {
      // Debug: expose store to window for debugging
      if (typeof window !== 'undefined') {
        (window as any).__uiPreferencesStore = { getState: get };
      }
      return {
      autoScrollEnabled: true, // Enabled by default

      _hasHydrated: false,

      setHasHydrated: (state: boolean) => {
        set({ _hasHydrated: state });
      },

      setAutoScrollEnabled: (enabled: boolean) => {
        set({ autoScrollEnabled: enabled });
      },

      toggleAutoScroll: () => {
        set((state) => ({ autoScrollEnabled: !state.autoScrollEnabled }));
      },
    }},
    {
      name: CLIENT_CONFIG.storage.uiPreferences,
      partialize: (state) => ({
        autoScrollEnabled: state.autoScrollEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
