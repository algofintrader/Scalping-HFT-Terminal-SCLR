import { create } from 'zustand';
import { CLIENT_CONFIG } from '../config';
import { useAuthStore } from './auth';
import { useWorkspaceStore } from './workspace';

export interface UserSettings {
  instruments: Array<{ id: string; symbol: string }>;
  autoScrollEnabled: boolean;
}

interface SessionState {
  // Migration state
  migrationPending: boolean;
  serverSettings: UserSettings | null;
  localSettings: UserSettings | null;

  // Actions
  checkMigration: () => Promise<void>;
  resolveConflict: (choice: 'local' | 'server') => Promise<void>;
  dismissMigration: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  migrationPending: false,
  serverSettings: null,
  localSettings: null,

  checkMigration: async () => {
    const { accessToken, user, status } = useAuthStore.getState();

    if (status !== 'authenticated' || !accessToken || !user) {
      return;
    }

    try {
      // Fetch server settings
      const response = await fetch(`${CLIENT_CONFIG.auth.apiBaseUrl + '/api'}/user/settings`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.error('[Session] Failed to fetch server settings:', response.status);
        return;
      }

      const serverSettings: UserSettings = await response.json();

      // Get local settings from workspace
      const { instruments } = useWorkspaceStore.getState();
      const { autoScrollEnabled } = JSON.parse(
        localStorage.getItem(CLIENT_CONFIG.storage.uiPreferences) || '{"autoScrollEnabled":true}'
      );

      const localSettings: UserSettings = {
        instruments: instruments.map((inst) => ({ id: inst.id, symbol: inst.symbol })),
        autoScrollEnabled,
      };

      // Check for migration scenarios
      const serverHasData = serverSettings.instruments.length > 0;
      const localHasData = localSettings.instruments.length > 0;

      console.log('[Session] Migration check:', {
        serverHasData,
        localHasData,
        serverInstruments: serverSettings.instruments.length,
        localInstruments: localSettings.instruments.length,
      });

      // Case 1: Server empty, local has data -> auto-migrate to server
      if (!serverHasData && localHasData) {
        console.log('[Session] Auto-migrating local settings to server');
        await get().resolveConflict('local');
        return;
      }

      // Case 2: Local empty, server has data -> auto-load from server
      if (serverHasData && !localHasData) {
        console.log('[Session] Auto-loading settings from server');
        await get().resolveConflict('server');
        return;
      }

      // Case 3: Both have data -> show conflict modal
      if (serverHasData && localHasData) {
        // Check if they're actually different
        const sameInstruments =
          serverSettings.instruments.length === localSettings.instruments.length &&
          serverSettings.instruments.every((s) =>
            localSettings.instruments.some((l) => l.symbol === s.symbol)
          );

        if (!sameInstruments) {
          console.log('[Session] Conflict detected, showing migration modal');
          set({
            migrationPending: true,
            serverSettings,
            localSettings,
          });
          return;
        }
      }

      // Case 4: Both empty or identical -> nothing to do
      console.log('[Session] No migration needed');
    } catch (error) {
      console.error('[Session] Migration check failed:', error);
    }
  },

  resolveConflict: async (choice: 'local' | 'server') => {
    const { accessToken } = useAuthStore.getState();
    const { serverSettings, localSettings } = get();

    if (!accessToken) {
      console.error('[Session] No access token for migration');
      return;
    }

    try {
      if (choice === 'local') {
        // Save local settings to server
        const settingsToSave = localSettings || {
          instruments: useWorkspaceStore.getState().instruments.map((inst) => ({
            id: inst.id,
            symbol: inst.symbol,
          })),
          autoScrollEnabled: JSON.parse(
            localStorage.getItem(CLIENT_CONFIG.storage.uiPreferences) || '{"autoScrollEnabled":true}'
          ).autoScrollEnabled,
        };

        const response = await fetch(`${CLIENT_CONFIG.auth.apiBaseUrl + '/api'}/user/settings`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(settingsToSave),
        });

        if (!response.ok) {
          throw new Error('Failed to save settings to server');
        }

        console.log('[Session] Local settings saved to server');
      } else {
        // Load server settings to local
        if (!serverSettings) {
          console.error('[Session] No server settings to load');
          return;
        }

        // Load instruments into workspace
        const { loadInstruments } = useWorkspaceStore.getState();
        loadInstruments(serverSettings.instruments);

        // Load UI preferences
        const currentPrefs = JSON.parse(
          localStorage.getItem(CLIENT_CONFIG.storage.uiPreferences) || '{}'
        );
        localStorage.setItem(
          CLIENT_CONFIG.storage.uiPreferences,
          JSON.stringify({
            ...currentPrefs,
            autoScrollEnabled: serverSettings.autoScrollEnabled,
          })
        );

        console.log('[Session] Server settings loaded to local');
      }

      // Clear migration state
      set({
        migrationPending: false,
        serverSettings: null,
        localSettings: null,
      });
    } catch (error) {
      console.error('[Session] Migration resolve failed:', error);
    }
  },

  dismissMigration: () => {
    set({
      migrationPending: false,
      serverSettings: null,
      localSettings: null,
    });
  },
}));
