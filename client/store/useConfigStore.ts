import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { clearGpuCrashFlag } from '../utils/liteRtCrashFlag';

export interface SuggestionStarter {
  label: string;
  text: string;
  agent: string;
}

export type ConnectionMode = 'server' | 'local' | 'cloud';
export type ProviderSlug = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'custom';

export interface CloudProviderConfig {
  model: string;
  baseUrl?: string;
}

export const PROVIDER_SLUGS: ProviderSlug[] = [
  'gemini',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'custom',
];

export const DEFAULT_CLOUD_PROVIDERS: Record<ProviderSlug, CloudProviderConfig> = {
  gemini: { model: 'gemini-1.5-flash' },
  openai: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-3-5-sonnet-20241022' },
  openrouter: { model: 'anthropic/claude-3.5-sonnet' },
  groq: { model: 'llama-3.3-70b-versatile' },
  custom: { model: '', baseUrl: '' },
};

export const getCloudKeyStorageKey = (provider: ProviderSlug) => `vela-key-${provider}`;

export const computeIsConfigured = (state: {
  connectionMode: ConnectionMode;
  apiUrl?: string;
  apiKey?: string;
  localModelName?: string;
  activeCloudProvider?: ProviderSlug;
  cloudProviders?: Record<ProviderSlug, CloudProviderConfig>;
  cloudApiKeys?: Partial<Record<ProviderSlug, string>>;
}): boolean => {
  if (state.connectionMode === 'server') {
    return Boolean(state.apiUrl && state.apiKey);
  }
  if (state.connectionMode === 'local') {
    return Boolean(state.localModelName);
  }
  if (state.connectionMode === 'cloud') {
    const provider = state.activeCloudProvider || 'gemini';
    const config = state.cloudProviders?.[provider];
    const model = config?.model;
    const key = state.cloudApiKeys?.[provider];
    if (provider === 'custom') {
      return Boolean(model && key && config?.baseUrl?.trim());
    }
    return Boolean(model && key);
  }
  return false;
};

export type PermissionTier = 'auto' | 'confirm' | 'deny';

export type GpuBackendPreference = 'auto' | 'opencl' | 'vulkan' | 'cpu';
export type GpuQuantPreference = 'auto' | 'q4_0' | 'q4_k_m' | 'q8_0';

export type OSPermission = 'notifications' | 'camera' | 'microphone' | 'storage' | 'accessibility' | 'background' | 'phone' | 'contacts';
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
  contacts: PermissionTier;
}

export const DEFAULT_DEVICE_AGENT_PERMISSIONS: DeviceAgentPermissions = {
  screen_read: 'auto',
  info: 'auto',
  screenshot: 'auto',
  open_app: 'auto',
  scroll: 'auto',
  swipe: 'confirm',
  press_key: 'auto',
  set_volume: 'auto',
  type: 'confirm',
  tap: 'confirm',
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
  contacts: 'auto',
};

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
  defaultAgent: string;
  userName: string;
  suggestionStarters: SuggestionStarter[];
  setTheme: (theme: 'deep' | 'slate' | 'cyberpunk' | 'nordic' | 'dracula' | 'oled') => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setAccentColor: (color: 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'pink' | 'orange' | 'blue') => void;
  setSystemPrompt: (prompt: string) => void;
  setTemperature: (temp: number) => void;
  setModelName: (model: string) => void;
  setDefaultAgent: (agent: string) => void;
  setUserName: (name: string) => void;
  setSuggestionStarters: (starters: SuggestionStarter[]) => void;
  deviceAgentPermissions: DeviceAgentPermissions;
  setDeviceAgentPermission: (action: keyof DeviceAgentPermissions, tier: PermissionTier) => void;
  osPermissions: Record<OSPermission, OSPermissionStatus>;
  setOSPermission: (perm: OSPermission, status: OSPermissionStatus) => void;
  
  // Connection and provider modes
  connectionMode: ConnectionMode;
  setConnectionMode: (mode: ConnectionMode) => void;
  cloudProviders: Record<ProviderSlug, CloudProviderConfig>;
  setCloudProviderConfig: (provider: ProviderSlug, config: Partial<CloudProviderConfig>) => void;
  activeCloudProvider: ProviderSlug;
  setActiveCloudProvider: (provider: ProviderSlug) => void;
  cloudApiKeys: Partial<Record<ProviderSlug, string>>;
  setCloudApiKey: (provider: ProviderSlug, key: string) => Promise<void>;
  deleteCloudApiKey: (provider: ProviderSlug) => Promise<void>;
  loadCloudApiKeys: () => Promise<void>;

  // Local model configuration settings
  localModelDownloadProgress: number | null;
  wifiOnlyDownload: boolean;
  localModelName: string;
  localContextSize: number;
  localMaxTokens: number;
  localConfigAutoApplied: boolean;
  detectedRamBytes: number | null;
  maxSteps: number;
  maxStepsEnabled: boolean;
  contextCompression: boolean;
  systemPromptEnabled: boolean;
  maxTokens: number;
  gpuBackendPreference: GpuBackendPreference;
  gpuQuantPreference: GpuQuantPreference;
  setLocalModelDownloadProgress: (val: number | null) => void;
  setWifiOnlyDownload: (val: boolean) => void;
  setLocalModelName: (val: string) => void;
  setLocalContextSize: (val: number) => void;
  setLocalMaxTokens: (val: number) => void;
  setLocalConfigAutoApplied: (val: boolean) => void;
  setDetectedRamBytes: (val: number | null) => void;
  setMaxSteps: (val: number) => void;
  setMaxStepsEnabled: (val: boolean) => void;
  setContextCompression: (val: boolean) => void;
  setSystemPromptEnabled: (val: boolean) => void;
  setMaxTokens: (val: number) => void;
  setGpuBackendPreference: (val: GpuBackendPreference) => void;
  setGpuQuantPreference: (val: GpuQuantPreference) => void;
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
      defaultAgent: 'personal assistant',
      userName: 'Parth',
    suggestionStarters: [
      { label: '👩🏫 Teach Concept', text: 'Teach intuition behind binary search with trace example', agent: 'teacher' },
      { label: '📊 Data Analyst', text: 'Analyze key features of 2026 FIFA World Cup matches', agent: 'analyst' },
      { label: '✍️ Prompt Architect', text: 'Help draft detailed system prompt for weather assistant bot', agent: 'prompt builder' }
    ],
    deviceAgentPermissions: { ...DEFAULT_DEVICE_AGENT_PERMISSIONS },
      osPermissions: {
        notifications: 'undetermined',
        camera: 'undetermined',
        microphone: 'undetermined',
        storage: 'granted',
        accessibility: 'undetermined',
        background: 'undetermined',
        phone: 'undetermined',
        contacts: 'undetermined',
      } as Record<OSPermission, OSPermissionStatus>,
      
      // Defaults for connection mode
      connectionMode: 'server',
      cloudProviders: DEFAULT_CLOUD_PROVIDERS,
      activeCloudProvider: 'gemini',
      cloudApiKeys: {},

      // Defaults for local mode
      localModelDownloadProgress: null,
      wifiOnlyDownload: true,
      // Must match a `name` in LOCAL_MODELS (utils/localLlm.ts)
      localModelName: 'DeepSeek-R1 1.5B (GGUF)',
      localContextSize: 2048,
      localMaxTokens: 512,
      localConfigAutoApplied: false,
      detectedRamBytes: null,
      maxSteps: 15,
      maxStepsEnabled: true,
      contextCompression: true,
      systemPromptEnabled: true,
      maxTokens: 4096,
      gpuBackendPreference: 'auto',
      gpuQuantPreference: 'auto',

      setConfig: (url, key) => {
        set((state) => ({
          apiUrl: url,
          apiKey: key,
          isConfigured: computeIsConfigured({ ...state, apiUrl: url, apiKey: key }),
        }));
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
          defaultAgent: 'personal assistant',
          userName: 'Parth',
          connectionMode: 'server',
          cloudProviders: DEFAULT_CLOUD_PROVIDERS,
          activeCloudProvider: 'gemini',
          cloudApiKeys: {},
          localModelDownloadProgress: null,
          wifiOnlyDownload: true,
          localModelName: 'DeepSeek-R1 1.5B (GGUF)',
          localContextSize: 2048,
          localMaxTokens: 512,
          localConfigAutoApplied: false,
          detectedRamBytes: null,
          maxSteps: 15,
          maxStepsEnabled: true,
          contextCompression: true,
          systemPromptEnabled: true,
          maxTokens: 4096,
          gpuBackendPreference: 'auto',
          gpuQuantPreference: 'auto',
          deviceAgentPermissions: { ...DEFAULT_DEVICE_AGENT_PERMISSIONS },
          osPermissions: {
            notifications: 'undetermined',
            camera: 'undetermined',
            microphone: 'undetermined',
            storage: 'granted',
            accessibility: 'undetermined',
            background: 'undetermined',
            phone: 'undetermined',
            contacts: 'undetermined',
          } as Record<OSPermission, OSPermissionStatus>,
          suggestionStarters: [
            { label: '👩🏫 Teach Concept', text: 'Teach intuition behind binary search trace example', agent: 'teacher' },
            { label: '📊 Data Analyst', text: 'Analyze key features 2026 FIFA World Cup matches', agent: 'analyst' },
            { label: '✍️ Prompt Architect', text: 'Help draft detailed system prompt weather assistant bot', agent: 'prompt builder' }
          ]
        });
        if (Platform.OS !== 'web') {
          SecureStore.deleteItemAsync(SECURE_KEY).catch((err) => {
            console.error('[useConfigStore] Failed to delete apiKey in SecureStore:', err);
          });
          for (const slug of PROVIDER_SLUGS) {
            SecureStore.deleteItemAsync(getCloudKeyStorageKey(slug)).catch(() => {});
          }
        }
        clearGpuCrashFlag().catch((err) => {
          console.error('[useConfigStore] Failed to clear LiteRT crash keys:', err);
        });
      },
      setHasHydrated: (val) => set({ hasHydrated: val }),
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      setTemperature: (temperature) => set({ temperature }),
      setModelName: (modelName) => set({ modelName }),
      setDefaultAgent: (defaultAgent) => set({ defaultAgent }),
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
      
      // Settors for connection & cloud mode
      setConnectionMode: (connectionMode) =>
        set((state) => ({
          connectionMode,
          isConfigured: computeIsConfigured({ ...state, connectionMode }),
        })),
      setCloudProviderConfig: (provider, config) =>
        set((state) => {
          const updated = {
            ...state.cloudProviders,
            [provider]: {
              ...state.cloudProviders[provider],
              ...config,
            },
          };
          return {
            cloudProviders: updated,
            isConfigured: computeIsConfigured({ ...state, cloudProviders: updated }),
          };
        }),
      setActiveCloudProvider: (activeCloudProvider) =>
        set((state) => ({
          activeCloudProvider,
          isConfigured: computeIsConfigured({ ...state, activeCloudProvider }),
        })),
      setCloudApiKey: async (provider, key) => {
        if (Platform.OS !== 'web') {
          await SecureStore.setItemAsync(getCloudKeyStorageKey(provider), key);
        }
        set((state) => {
          const updatedKeys = {
            ...state.cloudApiKeys,
            [provider]: key,
          };
          return {
            cloudApiKeys: updatedKeys,
            isConfigured: computeIsConfigured({ ...state, cloudApiKeys: updatedKeys }),
          };
        });
      },
      deleteCloudApiKey: async (provider) => {
        if (Platform.OS !== 'web') {
          await SecureStore.deleteItemAsync(getCloudKeyStorageKey(provider));
        }
        set((state) => {
          const updatedKeys = { ...state.cloudApiKeys };
          delete updatedKeys[provider];
          return {
            cloudApiKeys: updatedKeys,
            isConfigured: computeIsConfigured({ ...state, cloudApiKeys: updatedKeys }),
          };
        });
      },
      loadCloudApiKeys: async () => {
        if (Platform.OS === 'web') return;
        const entries = await Promise.all(
          PROVIDER_SLUGS.map(async (slug) => {
            try {
              const val = await SecureStore.getItemAsync(getCloudKeyStorageKey(slug));
              return [slug, val] as const;
            } catch (e) {
              console.error(`[useConfigStore] Failed loading cloud key for ${slug}:`, e);
              return [slug, null] as const;
            }
          })
        );
        const keys: Partial<Record<ProviderSlug, string>> = {};
        for (const [slug, val] of entries) {
          if (val) keys[slug] = val;
        }
        set((state) => ({
          cloudApiKeys: keys,
          isConfigured: computeIsConfigured({ ...state, cloudApiKeys: keys }),
        }));
      },

      // Settors for local mode
      setLocalModelDownloadProgress: (localModelDownloadProgress) => set({ localModelDownloadProgress }),
      setWifiOnlyDownload: (wifiOnlyDownload) => set({ wifiOnlyDownload }),
      setLocalModelName: (localModelName) =>
        set((state) => ({
          localModelName,
          isConfigured: computeIsConfigured({ ...state, localModelName }),
        })),
      setLocalContextSize: (localContextSize) => set({ localContextSize }),
      setLocalMaxTokens: (localMaxTokens) => set({ localMaxTokens }),
      setLocalConfigAutoApplied: (localConfigAutoApplied) => set({ localConfigAutoApplied }),
      setDetectedRamBytes: (detectedRamBytes) => set({ detectedRamBytes }),
      setMaxSteps: (maxSteps) => set({ maxSteps }),
      setMaxStepsEnabled: (maxStepsEnabled) => set({ maxStepsEnabled }),
      setContextCompression: (contextCompression) => set({ contextCompression }),
      setSystemPromptEnabled: (systemPromptEnabled) => set({ systemPromptEnabled }),
      setMaxTokens: (maxTokens) => set({ maxTokens }),
      setGpuBackendPreference: (gpuBackendPreference) => set({ gpuBackendPreference }),
      setGpuQuantPreference: (gpuQuantPreference) => set({ gpuQuantPreference }),
    }),
    {
      name: 'vela-config-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // v1: the GGUF model list was replaced with LiteRT `.task` models, so any
      // persisted `localModelName` pointing at a removed model must be reset —
      // otherwise the stale name never matches LOCAL_MODELS and local mode
      // silently falls back to mock responses.
      // v2 (#294): 'Cactus Needle 45M' was hard-migrated to the live
      // Cactus-Compute needle2/needle3 entries (its old HF URL is dead,
      // HTTP 401) — reset the removed name the same way.
      // v3 (#313 / #333): connectionMode ('server' | 'local' | 'cloud') replaces
      // isLocalMode, adding cloudProviders and activeCloudProvider.
      // v4 (#356/#357): defaultPersona -> defaultAgent.
      // v5 (#357): suggestionStarters[].persona -> suggestionStarters[].agent.
      version: 5,
      migrate: (persistedState: any, fromVersion: number) => {
        if (persistedState) {
          if (fromVersion < 4) {
            if (persistedState.defaultAgent === undefined) {
              persistedState.defaultAgent = persistedState.defaultPersona ?? 'personal assistant';
            }
            delete persistedState.defaultPersona;
          }
          if (fromVersion < 5 && Array.isArray(persistedState.suggestionStarters)) {
            persistedState.suggestionStarters = persistedState.suggestionStarters.map(
              (starter: any) => {
                if (starter && starter.agent === undefined && starter.persona !== undefined) {
                  const { persona, ...rest } = starter;
                  return { ...rest, agent: persona };
                }
                return starter;
              }
            );
          }
          if (fromVersion < 1) {
            const retired = ['Gemma 2B', 'Phi-3 Mini', 'Llama 3 8B'];
            if (retired.includes(persistedState.localModelName)) {
              persistedState.localModelName = 'DeepSeek-R1 1.5B (GGUF)';
              persistedState.isLocalMode = false;
            }
          }
          if (fromVersion < 2 && persistedState.localModelName === 'Cactus Needle 45M') {
            persistedState.localModelName = 'DeepSeek-R1 1.5B (GGUF)';
            persistedState.isLocalMode = false;
          }
          if (fromVersion < 3) {
            persistedState.connectionMode = persistedState.isLocalMode ? 'local' : 'server';
            delete persistedState.isLocalMode;
            if (!persistedState.cloudProviders) {
              persistedState.cloudProviders = DEFAULT_CLOUD_PROVIDERS;
            }
            if (!persistedState.activeCloudProvider) {
              persistedState.activeCloudProvider = 'gemini';
            }
            persistedState.isConfigured = computeIsConfigured(persistedState);
          }
          if (persistedState.maxSteps === undefined) {
            persistedState.maxSteps = 15;
          }
          if (persistedState.maxStepsEnabled === undefined) {
            persistedState.maxStepsEnabled = true;
          }
          if (persistedState.temperature === undefined) {
            persistedState.temperature = 0.7;
          }
          if (persistedState.maxTokens === undefined) {
            persistedState.maxTokens = 4096;
          }
          if (persistedState.contextCompression === undefined) {
            persistedState.contextCompression = true;
          }
          if (persistedState.systemPromptEnabled === undefined) {
            persistedState.systemPromptEnabled = true;
          }
          if (persistedState.gpuBackendPreference === undefined) {
            persistedState.gpuBackendPreference = 'auto';
          }
          if (persistedState.gpuQuantPreference === undefined) {
            persistedState.gpuQuantPreference = 'auto';
          }
        }
        return persistedState;
      },
      partialize: (state) => {
        // Exclude hasHydrated (session state). securely store apiKey on native
        const { hasHydrated, cloudApiKeys, ...rest } = state;
        if (Platform.OS === 'web') {
          return { ...rest, cloudApiKeys };
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
        // Native: load apiKey and cloudApiKeys from SecureStore after AsyncStorage rehydrated.
        if (Platform.OS !== 'web') {
          const loadKeys = async () => {
            try {
              const [secureKey, cloudKeyEntries] = await Promise.all([
                SecureStore.getItemAsync(SECURE_KEY).catch((err) => {
                  console.error('[useConfigStore] Failed loading server apiKey:', err);
                  return null;
                }),
                Promise.all(
                  PROVIDER_SLUGS.map(async (slug) => {
                    try {
                      const k = await SecureStore.getItemAsync(getCloudKeyStorageKey(slug));
                      return [slug, k] as const;
                    } catch (e) {
                      console.error(`[useConfigStore] Failed loading cloud key for ${slug}:`, e);
                      return [slug, null] as const;
                    }
                  })
                ),
              ]);

              const cloudKeys: Partial<Record<ProviderSlug, string>> = {};
              for (const [slug, k] of cloudKeyEntries) {
                if (k) cloudKeys[slug] = k;
              }

              useConfigStore.setState((s) => {
                const apiKey = secureKey ?? s.apiKey;
                return {
                  apiKey,
                  cloudApiKeys: cloudKeys,
                  isConfigured: computeIsConfigured({ ...s, apiKey, cloudApiKeys: cloudKeys }),
                };
              });
            } catch (err) {
              console.error('[useConfigStore] SecureStore load error:', err);
            } finally {
              hydratedState.setHasHydrated(true);
            }
          };
          loadKeys();
        } else {
          useConfigStore.setState((s) => ({
            isConfigured: computeIsConfigured(s),
          }));
          hydratedState.setHasHydrated(true);
        }
      }
    }
  )
);
