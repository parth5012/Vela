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
  
  // Local mode configuration settings
  isLocalMode: boolean;
  localModelDownloadProgress: number | null;
  wifiOnlyDownload: boolean;
  localModelName: string;
  setIsLocalMode: (val: boolean) => void;
  setLocalModelDownloadProgress: (val: number | null) => void;
  setWifiOnlyDownload: (val: boolean) => void;
  setLocalModelName: (val: string) => void;
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
        { label: '👩🏫 Teach Concept', text: 'Teach intuition behind binary search trace example', persona: 'teacher' },
        { label: '📊 Data Analyst', text: 'Analyze key features 2026 FIFA World Cup matches', persona: 'analyst' },
        { label: '✍️ Prompt Architect', text: 'Help draft detailed system prompt weather assistant bot', persona: 'prompt builder' }
      ],
      
      // Defaults for local mode
      isLocalMode: false,
      localModelDownloadProgress: null,
      wifiOnlyDownload: true,
      localModelName: 'Gemma 2B',

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
      
      // Settors for local mode
      setIsLocalMode: (isLocalMode) => set({ isLocalMode }),
      setLocalModelDownloadProgress: (localModelDownloadProgress) => set({ localModelDownloadProgress }),
      setWifiOnlyDownload: (wifiOnlyDownload) => set({ wifiOnlyDownload }),
      setLocalModelName: (localModelName) => set({ localModelName })
    }),
    {
      name: 'vela-config-storage',
      storage: createJSONStorage(() => AsyncStorage),
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
