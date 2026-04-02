import { CLIENT_CONFIG } from '../config';
import { useAuthStore } from './auth';
import { useWorkspaceStore, type Instrument } from './workspace';
import { useUIPreferencesStore } from './uiPreferences';

interface GuestSettings {
  instruments: Instrument[];
  autoScrollEnabled: boolean;
}

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSync() {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(() => {
    syncToServer();
  }, CLIENT_CONFIG.auth.guestSyncDebounceMs);
}

async function syncToServer(): Promise<void> {
  const authState = useAuthStore.getState();

  const settings: GuestSettings = {
    instruments: useWorkspaceStore.getState().instruments,
    autoScrollEnabled: useUIPreferencesStore.getState().autoScrollEnabled,
  };

  try {
    let response: Response;

    if (authState.status === 'authenticated' && authState.accessToken) {
      response = await fetch(
        `${CLIENT_CONFIG.auth.apiBaseUrl}/api/user/settings`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authState.accessToken}`,
          },
          body: JSON.stringify(settings),
        }
      );

      if (!response.ok) {
        console.warn('[SettingsSync] Failed to sync user settings:', response.status);
      } else {
        console.log('[SettingsSync] User settings synced to server');
      }
    } else if (authState.status === 'guest' && authState.guestId) {
      response = await fetch(
        `${CLIENT_CONFIG.auth.apiBaseUrl}/api/guest/${authState.guestId}/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        }
      );

      if (!response.ok) {
        console.warn('[SettingsSync] Failed to sync guest settings:', response.status);
      } else {
        console.log('[SettingsSync] Guest settings synced to server');
      }
    }
  } catch (error) {
    console.warn('[SettingsSync] Failed to sync settings:', error);
  }
}

export async function loadGuestSettingsFromServer(): Promise<GuestSettings | null> {
  const authState = useAuthStore.getState();

  if (!authState.guestId) {
    return null;
  }

  try {
    const response = await fetch(
      `${CLIENT_CONFIG.auth.apiBaseUrl}/api/guest/${authState.guestId}/settings`
    );

    if (!response.ok) {
      return null;
    }

    const settings: GuestSettings = await response.json();
    return settings;
  } catch (error) {
    console.warn('[GuestSync] Failed to load settings from server:', error);
    return null;
  }
}

let unsubscribeWorkspace: (() => void) | null = null;
let unsubscribeUIPrefs: (() => void) | null = null;
let prevInstrumentsLength = 0;
let prevAutoScroll = true;

export function initGuestSync(): void {
  prevInstrumentsLength = useWorkspaceStore.getState().instruments.length;
  prevAutoScroll = useUIPreferencesStore.getState().autoScrollEnabled;

  unsubscribeWorkspace = useWorkspaceStore.subscribe((state) => {
    if (state.instruments.length !== prevInstrumentsLength) {
      prevInstrumentsLength = state.instruments.length;
      debouncedSync();
    }
  });

  unsubscribeUIPrefs = useUIPreferencesStore.subscribe((state) => {
    if (state.autoScrollEnabled !== prevAutoScroll) {
      prevAutoScroll = state.autoScrollEnabled;
      debouncedSync();
    }
  });

  console.log('[GuestSync] Initialized');
}

export function stopGuestSync(): void {
  if (unsubscribeWorkspace) {
    unsubscribeWorkspace();
    unsubscribeWorkspace = null;
  }
  if (unsubscribeUIPrefs) {
    unsubscribeUIPrefs();
    unsubscribeUIPrefs = null;
  }

  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }

  console.log('[GuestSync] Stopped');
}

export function applyGuestSettings(settings: GuestSettings): void {
  useUIPreferencesStore.getState().setAutoScrollEnabled(settings.autoScrollEnabled);

  console.log('[GuestSync] Applied settings from server');
}
