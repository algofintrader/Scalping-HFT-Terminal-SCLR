import { useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Workspace } from './components/Workspace';
import { MobileWorkspace } from './components/MobileWorkspace';
import { AuthModal } from './components/AuthModal';
import { MigrationModal } from './components/MigrationModal';
import { useConnectionStore } from './stores/connection';
import { useWorkspaceStore } from './stores/workspace';
import { useUIPreferencesStore } from './stores/uiPreferences';
import { useMarketDataStore } from './stores/marketData';
import { useAuthStore } from './stores/auth';
import { useSessionStore } from './stores/session';
import { initGuestSync, loadGuestSettingsFromServer } from './stores/guestSync';
import { useMobile } from './hooks/useMobile';

export default function App() {
  const isMobile = useMobile();
  const isConnected = useConnectionStore((state) => state.isConnected);
  const hasHydrated = useWorkspaceStore((state) => state._hasHydrated);
  const instruments = useWorkspaceStore((state) => state.instruments);
  const resubscribeAll = useWorkspaceStore((state) => state.resubscribeAll);
  const initializeDefaults = useWorkspaceStore((state) => state.initializeDefaults);

  // Auth store
  const authHasHydrated = useAuthStore((state) => state._hasHydrated);
  const authStatus = useAuthStore((state) => state.status);
  const initGuest = useAuthStore((state) => state.initGuest);

  // Session store for migration
  const checkMigration = useSessionStore((state) => state.checkMigration);

  // Track if we've already initialized to prevent double initialization
  const hasInitialized = useRef(false);
  const guestSyncInitialized = useRef(false);
  const migrationChecked = useRef(false);
  const symbolsInfoLoaded = useRef(false);

  // Load symbols info (tickSize, pricePrecision) at startup
  useEffect(() => {
    if (symbolsInfoLoaded.current) return;
    symbolsInfoLoaded.current = true;

    // Relative path works both locally (via vite proxy) and in production
    fetch('/api/symbols')
      .then(res => res.json())
      .then(data => {
        if (data.symbols && Array.isArray(data.symbols)) {
          useMarketDataStore.getState().setSymbolsInfo(data.symbols);
        }
      })
      .catch(err => {
        console.error('[App] Failed to load symbols info:', err);
      });
  }, []);

  // Initialize guest session when auth store is hydrated
  useEffect(() => {
    if (authHasHydrated && authStatus === 'guest') {
      initGuest();

      // Try to load settings from server if localStorage is empty (fallback for guest)
      if (!guestSyncInitialized.current) {
        const localInstruments = useWorkspaceStore.getState().instruments;
        if (localInstruments.length === 0) {
          loadGuestSettingsFromServer().then((settings) => {
            if (settings && settings.instruments.length > 0) {
              console.log('[App] Restoring settings from server backup');
              useWorkspaceStore.getState().loadInstruments(settings.instruments);
              useUIPreferencesStore.getState().setAutoScrollEnabled(settings.autoScrollEnabled);
            }
          });
        }
      }
    }

    // Initialize settings sync for both guest and authenticated users (only once)
    if (authHasHydrated && !guestSyncInitialized.current) {
      guestSyncInitialized.current = true;
      initGuestSync();
    }
  }, [authHasHydrated, authStatus, initGuest]);

  // Check migration when user becomes authenticated
  useEffect(() => {
    if (authStatus === 'authenticated' && !migrationChecked.current) {
      migrationChecked.current = true;
      checkMigration();
    }

    // Reset migration check flag when user logs out
    if (authStatus === 'guest') {
      migrationChecked.current = false;
    }
  }, [authStatus, checkMigration]);

  // Initialize default instruments OR resubscribe to saved ones
  useEffect(() => {
    if (isConnected && hasHydrated && !hasInitialized.current) {
      hasInitialized.current = true;

      if (instruments.length === 0) {
        // First launch — add default instruments
        console.log('[App] First launch, initializing default instruments');
        initializeDefaults();
      } else {
        // Returning user — restore subscriptions
        console.log('[App] Restoring subscriptions for', instruments.length, 'instruments');
        resubscribeAll();
      }
    }

    // Reset flag when disconnected
    if (!isConnected) {
      hasInitialized.current = false;
    }
  }, [isConnected, hasHydrated, instruments.length, resubscribeAll, initializeDefaults]);

  // Mobile version - simplified beta
  if (isMobile) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)'
      }}>
        <MobileWorkspace />
        <AuthModal />
        <MigrationModal />
      </div>
    );
  }

  // Desktop version
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)'
    }}>
      <Header />
      <Workspace />
      <AuthModal />
      <MigrationModal />
    </div>
  );
}
