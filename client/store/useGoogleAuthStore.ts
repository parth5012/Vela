import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- Types ---

export interface GoogleUserInfo {
  name: string;
  email: string;
  picture?: string;
  sub?: string;
}

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number; // epoch ms
}

export type GoogleWorkspaceScope =
  | 'openid'
  | 'profile'
  | 'email'
  | 'gmail.readonly'
  | 'gmail.modify'
  | 'calendar.readonly'
  | 'calendar.events'
  | 'drive.readonly'
  | 'drive.file'
  | 'docs.readonly'
  | 'sheets.readonly';

interface GoogleAuthState {
  /** Whether the user has completed Google sign-in at least once */
  isConnected: boolean;
  /** Whether a sign-in operation is in flight */
  isSigningIn: boolean;
  /** User profile info fetched after sign-in */
  user: GoogleUserInfo | null;
  /** Last known error message */
  error: string | null;
  /** Whether tokens are synced to backend */
  backendConnected: boolean | null;
  /** Requested scopes */
  scopes: GoogleWorkspaceScope[];
  /** Last resolved access token (not persisted — held in memory + SecureStore) */
  _accessToken: string;
  _refreshToken: string;
  _idToken: string;
  _tokenExpiresAt: number;

  // --- Actions ---
  setTokens: (tokens: GoogleTokenSet) => void;
  setUser: (user: GoogleUserInfo) => void;
  setSigningIn: (val: boolean) => void;
  setError: (err: string | null) => void;
  setBackendConnected: (val: boolean | null) => void;
  clearAuth: () => void;
}

// Workspace scopes for agent access
const WORKSPACE_SCOPES: GoogleWorkspaceScope[] = [
  'openid',
  'profile',
  'email',
  'gmail.modify',
  'calendar.events',
  'drive.file',
];

// --- Store ---

export const useGoogleAuthStore = create<GoogleAuthState>()(
  persist(
    (set) => ({
      isConnected: false,
      isSigningIn: false,
      user: null,
      error: null,
      backendConnected: null,
      scopes: WORKSPACE_SCOPES,
      _accessToken: '',
      _refreshToken: '',
      _idToken: '',
      _tokenExpiresAt: 0,

      setTokens: (tokens) => {
        set({
          _accessToken: tokens.accessToken,
          _refreshToken: tokens.refreshToken || '',
          _idToken: tokens.idToken || '',
          _tokenExpiresAt: tokens.expiresAt,
          isConnected: true,
          error: null,
        });
      },

      setUser: (user) => set({ user, isConnected: true }),

      setSigningIn: (val) => set({ isSigningIn: val }),

      setError: (err) => set({ error: err, isSigningIn: false }),

      setBackendConnected: (val) => set({ backendConnected: val }),

      clearAuth: () => {
        set({
          isConnected: false,
          user: null,
          error: null,
          backendConnected: null,
          _accessToken: '',
          _refreshToken: '',
          _idToken: '',
          _tokenExpiresAt: 0,
          isSigningIn: false,
        });
      },
    }),
    {
      name: 'vela-google-auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isConnected: state.isConnected,
        user: state.user,
        backendConnected: state.backendConnected,
        scopes: state.scopes,
      }),
    }
  )
);
