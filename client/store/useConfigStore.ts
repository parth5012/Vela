import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SuggestionStarter {
  label: string;
  text: string;
  persona: string;
}

export type PermissionTier = 'auto' | 'confirm' | 'deny';

export type OSPermission = 'notifications' | 'camera' | 'microphone' | 'storage' | 'accessibility' | 'background';
export type OSPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface DeviceAgentPermissions {
  screen_read: PermissionTier;
  info: PermissionTier;
  screenshot: PermissionTier;
  open_app: PermissionTier;
  scroll: PermissionTier;
  swipe: PermissionTier;
  press_key: PermissionTier;
  set_volume: PermissionTier;
  type: PermissionTier;
  tap: PermissionTier;
  send_communication: PermissionTier;
  calls: PermissionTier;
  purchases: PermissionTier;
  deletions: PermissionTier;
  settings_changes: PermissionTier;
  play_installs: PermissionTier;
  passwords_otps: PermissionTier;
  sideloads: PermissionTier;
  permission_toggles: PermissionTier;
  root_shizuku: PermissionTier;
}

interface ConfigState {
  apiUrl: string;
  apiKey: string;
  isConfigured: boolean;
  hasHydrated: boolean;
  setConfig: (url: string, key: string) => void;
  clearConfig: () => void;
  setHasHydrated: (val: boolean) => void;
  theme: 'deep' | 'slate' | 'cyberpunk' | 'nordic' | 'dracula' | 'oled';
  fontSize: 'small' | 'medium' | 'large';
  accentColor: 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'pink' | 'orange' | 'blue';
  systemPrompt: string;
  temperature: number;
  modelName: string;
  defaultPersona: string;
  userName: string;
  suggestionStarters: SuggestionStarter[];
  setTheme: (theme: 'deep' | 'slate' | 'cyberpunk' | 'nordic' | 'dracula' | 'oled') => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setAccentColor: (color: 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'pink' | 'orange' | 'blue') => void;
  setSystemPrompt: (prompt: string) => void;
  setTemperature: (temp: number) => void;
  setModelName: (model: string) => void;
  setDefaultPersona: (persona: string) => void;
  setUserName: (name: string) => void;
  setSuggestionStarters: (starters: SuggestionStarter[]) => void;
  deviceAgentPermissions: DeviceAgentPermissions;
  setDeviceAgentPermission: (action: keyof DeviceAgentPermissions, tier: PermissionTier) => void;
  osPermissions: Record<OSPermission, OSPermissionStatus>;
  setOSPermission: (perm: OSPermission, status: OSPermissionStatus) => void;
  
  // Local mode configuration settings
  isLocalMode: boolean;
  localModelDownloadProgress: number | null;
  wifiOnlyDownload: boolean;
  localModelName: string;
  localContextSize: number;
  localMaxTokens: number;
  localConfigAutoApplied: boolean;
  detectedRamBytes: number | null;
  setIsLocalMode: (val: boolean) => void;
  setLocalModelDownloadProgress: (val: number | null) => void;
  setWifiOnlyDownload: (val: boolean) => void;
  setLocalModelName: (val: string) => void;
  setLocalContextSize: (val: number) => void;
  setLocalMaxTokens: (val: number) => void;
  setLocalConfigAutoApplied: (val: boolean) => void;
  setDetectedRamBytes: (val: number | null) => void;
}

const SECURE_KEY = 'vela-api-key';

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      apiUrl: '',
      apiKey: '',
      isConfigured: false,
      hasHydrated: false,
      theme: 'deep',
      fontSize: 'medium',
      accentColor: 'indigo',
      systemPrompt: 'You are an autonomous research agent.',
      temperature: 0.7,
      modelName: 'gemini-1.5-pro',
      defaultPersona: 'personal assistant',
      userName: 'Parth',
    suggestionStarters: [
      { label: '👩🏫 Teach Concept', text: 'Teach intuition behind binary search with trace example', persona: 'teacher' },
      { label: '📊 Data Analyst', text: 'Analyze key features of 2026 FIFA World Cup matches', persona: 'analyst' },
      { label: '✍️ Prompt Architect', text: 'Help draft detailed system prompt for weather assistant bot', persona: 'prompt builder' }
    ],
    deviceAgentPermissions: {
      screen_read: 'auto',
      info: 'auto',
      screenshot: 'auto',
      open_app: 'auto',
      scroll: 'auto',
      swipe: 'auto',
      press_key: 'auto',
      set_volume: 'auto',
      type: 'auto',
      tap: 'auto',
      send_communication: 'confirm',
      calls: 'confirm',
      purchases: 'confirm',
      deletions: 'confirm',
      settings_changes: 'confirm',
      play_installs: 'confirm',
      passwords_otps: 'deny',
      sideloads: 'deny',
      permission_toggles: 'deny',
      root_shizuku: 'deny',
    },
      osPermissions: {
        notifications: 'undetermined',
        camera: 'undetermined',
        microphone: 'undetermined',
        storage: 'granted',
        accessibility: 'undetermined',
        background: 'undetermined',
      } as Record<OSPermission, OSPermissionStatus>,
      
      // Defaults for local mode
      isLocalMode: false,
      localModelDownloadProgress: null,
      wifiOnlyDownload: true,
      // Must match a `name` in LOCAL_MODELS (utils/localLlm.ts)
      localModelName: 'DeepSeek-R1 1.5B (GGUF)',
    localContextSize: 2048,
    localMaxTokens: 512,
    localConfigAutoApplied: false,
    detectedRamBytes: null,

      setConfig: (url, key) => {
        set({ apiUrl: url, apiKey: key, isConfigured: true });
        if (Platform.OS !== 'web') {
          SecureStore.setItemAsync(SECURE_KEY, key).catch((err) => {
            console.error('[useConfigStore] Failed to save apiKey in SecureStore:', err);
          });
        }
      },
      clearConfig: () => {
        set({
          apiUrl: '',
          apiKey: '',
          isConfigured: false,
          theme: 'deep',
          fontSize: 'medium',
          accentColor: 'indigo',
          systemPrompt: 'You are an autonomous research agent.',
          temperature: 0.7,
          modelName: 'gemini-1.5-pro',
          defaultPersona: 'personal assistant',
          userName: 'Parth',
          isLocalMode: false,
          localModelDownloadProgress: null,
          wifiOnlyDownload: true,
          suggestionStarters: [
            { label: '👩🏫 Teach Concept', text: 'Teach intuition behind binary search trace example', persona: 'teacher' },
            { label: '📊 Data Analyst', text: 'Analyze key features 2026 FIFA World Cup matches', persona: 'analyst' },
            { label: '✍️ Prompt Architect', text: 'Help draft detailed system prompt weather assistant bot', persona: 'prompt builder' }
          ]
        });
        if (Platform.OS !== 'web') {
          SecureStore.deleteItemAsync(SECURE_KEY).catch((err) => {
            console.error('[useConfigStore] Failed to delete apiKey in SecureStore:', err);
          });
        }
      },
      setHasHydrated: (val) => set({ hasHydrated: val }),
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      setTemperature: (temperature) => set({ temperature }),
      setModelName: (modelName) => set({ modelName }),
      setDefaultPersona: (defaultPersona) => set({ defaultPersona }),
      setUserName: (userName) => set({ userName }),
      setSuggestionStarters: (suggestionStarters) => set({ suggestionStarters }),
  setDeviceAgentPermission: (action, tier) =>
    set((state) => ({
      deviceAgentPermissions: {
        ...state.deviceAgentPermissions,
        [action]: tier,
      },
    })),
      setOSPermission: (perm, status) =>
        set((state) => ({
          osPermissions: {
            ...state.osPermissions,
            [perm]: status,
          },
        })),
      
      // Settors for local mode
      setIsLocalMode: (isLocalMode) => set({ isLocalMode }),
      setLocalModelDownloadProgress: (localModelDownloadProgress) => set({ localModelDownloadProgress }),
      setWifiOnlyDownload: (wifiOnlyDownload) => set({ wifiOnlyDownload }),
      setLocalModelName: (localModelName) => set({ localModelName }),
    setLocalContextSize: (localContextSize) => set({ localContextSize }),
    setLocalMaxTokens: (localMaxTokens) => set({ localMaxTokens }),
    setLocalConfigAutoApplied: (localConfigAutoApplied) => set({ localConfigAutoApplied }),
    setDetectedRamBytes: (detectedRamBytes) => set({ detectedRamBytes })
    }),
    {
      name: 'vela-config-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // v1: the GGUF model list was replaced with LiteRT `.task` models, so any
      // persisted `localModelName` pointing at a removed model must be reset —
      // otherwise the stale name never matches LOCAL_MODELS and local mode
      // silently falls back to mock responses.
      version: 1,
      migrate: (persistedState: any, fromVersion: number) => {
        if (fromVersion < 1 && persistedState) {
          const retired = ['Gemma 2B', 'Phi-3 Mini', 'Llama 3 8B'];
          if (retired.includes(persistedState.localModelName)) {
            persistedState.localModelName = 'DeepSeek-R1 1.5B (GGUF)';
            persistedState.isLocalMode = false;
          }
        }
        return persistedState;
      },
      partialize: (state) => {
        // Exclude hasHydrated (session state). securely store apiKey on native
        const { hasHydrated, ...rest } = state;
        if (Platform.OS === 'web') {
          return rest;
        }
        return {
          ...rest,
          apiKey: '', // ApiKey stored in SecureStore on native
        };
      },
      onRehydrateStorage: (state) => (hydratedState, error) => {
        if (error || !hydratedState) {
          state?.setHasHydrated(true);
          return;
        }
        // Native: load apiKey from SecureStore after AsyncStorage rehydrated.
        if (Platform.OS !== 'web') {
          SecureStore.getItemAsync(SECURE_KEY)
            .then((secureKey) => {
              if (secureKey) {
                useConfigStore.setState({ apiKey: secureKey });
              }
            })
            .catch((err) => {
              console.error('[useConfigStore] SecureStore load error:', err);
            })
            .finally(() => {
              hydratedState.setHasHydrated(true);
            });
        } else {
          hydratedState.setHasHydrated(true);
        }
      }
    }
  )
);
