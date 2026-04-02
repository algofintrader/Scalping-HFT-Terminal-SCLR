import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLIENT_CONFIG } from '../config';

export type AuthStatus = 'guest' | 'authenticated' | 'loading';

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

interface AuthState {
  status: AuthStatus;
  guestId: string | null;
  user: User | null;
  accessToken: string | null;

  // Hydration flag
  _hasHydrated: boolean;

  // Actions
  setHasHydrated: (state: boolean) => void;
  initGuest: () => void;
  getGuestId: () => string;
  setLoading: () => void;
  setUser: (user: User, token: string) => void;
  logout: () => void;
  clearGuestId: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'guest',
      guestId: null,
      user: null,
      accessToken: null,
      _hasHydrated: false,

      setHasHydrated: (state: boolean) => {
        set({ _hasHydrated: state });
      },

      /**
       */
      initGuest: () => {
        const { guestId, status } = get();
        if (status === 'authenticated') return;
        if (guestId) return;

        const newGuestId = crypto.randomUUID();
        set({ guestId: newGuestId, status: 'guest' });
        console.log('[Auth] Created guest session:', newGuestId);
      },

      /**
       */
      getGuestId: () => {
        const { guestId, initGuest } = get();
        if (!guestId) {
          initGuest();
          return get().guestId!;
        }
        return guestId;
      },

      /**
       */
      setLoading: () => {
        set({ status: 'loading' });
      },

      /**
       */
      setUser: (user: User, token: string) => {
        set({
          user,
          accessToken: token,
          status: 'authenticated',
        });
        console.log('[Auth] User authenticated:', user.email);
      },

      /**
       */
      logout: () => {
        set({
          user: null,
          accessToken: null,
          status: 'guest',
        });
        console.log('[Auth] User logged out, back to guest mode');
      },

      /**
       */
      clearGuestId: () => {
        set({ guestId: null });
        console.log('[Auth] Guest ID cleared after migration');
      },
    }),
    {
      name: CLIENT_CONFIG.storage.auth,
      partialize: (state) => ({
        guestId: state.guestId,
        user: state.user,
        accessToken: state.accessToken,
        status: state.status,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export const selectAuthStatus = (state: AuthState) => state.status;
export const selectGuestId = (state: AuthState) => state.guestId;
export const selectUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.status === 'authenticated';
export const selectIsGuest = (state: AuthState) => state.status === 'guest';
