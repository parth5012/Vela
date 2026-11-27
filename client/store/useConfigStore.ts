import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { clearGpuCrashFlag } from '../utils/liteRtCrashFlag';
import { getOptimalSettingsForRam } from '../utils/ramDetection';
import type { ThemeName } from '../utils/theme';

export interface SuggestionStarter {
  label: string;
  text: string;
  agent: string;
}

export type ConnectionMode = 'server' | 'local' | 'cloud';
export type ProviderSlug = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'liquid' | 'custom';

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
  'liquid',
  'custom',
];

export const DEFAULT_CLOUD_PROVIDERS: Record<ProviderSlug, CloudProviderConfig> = {
  gemini: { model: 'gemini-1.5-flash' },
  openai: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-3-5-sonnet-20241022' },
  openrouter: { model: 'anthropic/claude-3.5-sonnet' },
  groq: { model: 'llama-3.3-70b-versatile' },
  liquid: { model: 'lfm-d1', baseUrl: 'https://api.liquid.ai/v1' },
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

export interface ModelOverrideConfig {
  contextSize?: number;
  maxTokens?: number;
  gpuBackend?: GpuBackendPreference;
}

export interface FloatingOverlayConfig {
  enabled: boolean;
  dockSide: 'left' | 'right';
  dockY: number;
  enableVoice: boolean;
  enableImages: boolean;
}

export const DEFAULT_FLOATING_OVERLAY_CONFIG: FloatingOverlayConfig = {
  enabled: false,
  dockSide: 'right',
  dockY: 200,
  enableVoice: true,
  enableImages: true,
};

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
  theme: ThemeName;
  fontSize: 'small' | 'medium' | 'large';
  accentColor: 'berry' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'teal' | 'orange' | 'blue';
  systemPrompt: string;
  temperature: number;
  modelName: string;
  defaultAgent: string;
  userName: string;
  suggestionStarters: SuggestionStarter[];
  setTheme: (theme: ThemeName) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setAccentColor: (color: 'berry' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'teal' | 'orange' | 'blue') => void;
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

  // #557: whether the onboarding wizard recorded a (still unconnected)
  // Google Workspace integration step.
  googleSetupPending: boolean;
  setGoogleSetupPending: (val: boolean) => void;

  taskHistoryRetention: number;
  setTaskHistoryRetention: (limit: number) => void;

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
  modelOverrides: Record<string, ModelOverrideConfig>;
  setModelOverride: (modelName: string, override: Partial<ModelOverrideConfig>) => void;
  clearModelOverride: (modelName: string) => void;
  applyModelSettings: (modelName: string) => void;
  acceptRecommendedConfig: () => void;
  prepareRecommendedForCustomize: () => void;
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

  // Multimodal configuration (#559, #562)
  maxImagesPerMessage: number;
  cloudPrivacyConsent: boolean;
  setMaxImagesPerMessage: (val: number) => void;
  setCloudPrivacyConsent: (val: boolean) => void;

  // Floating Overlay (mini-chat bubble) (#596, #599)
  floatingOverlay: FloatingOverlayConfig;
  setFloatingOverlay: (partial: Partial<FloatingOverlayConfig>) => void;
  setFloatingOverlayEnabled: (enabled: boolean) => void;
  setFloatingOverlayPosition: (dockSide: 'left' | 'right', dockY: number) => void;
}

const SECURE_KEY = 'vela-api-key';

const clampRestoredMaxTokens = (contextSize: number, maxTokens: number): number =>
  Math.min(maxTokens, Math.max(64, contextSize));

const applyRecommendedPreset = (state: ConfigState, autoApplied: boolean): Partial<ConfigState> | ConfigState => {
  if (
    typeof state.detectedRamBytes !== 'number' ||
    !Number.isFinite(state.detectedRamBytes) ||
    state.detectedRamBytes <= 0
  ) {
    return state;
  }
  const rec = getOptimalSettingsForRam(state.detectedRamBytes);
  const existingOverride = !autoApplied ? state.modelOverrides[rec.modelName] : undefined;
  const nextOverrides = { ...state.modelOverrides };
  if (autoApplied) {
    delete nextOverrides[rec.modelName];
  }
  const resolvedContextSize = existingOverride?.contextSize ?? rec.contextSize;
  const resolvedMaxTokens = clampRestoredMaxTokens(
    resolvedContextSize,
    existingOverride?.maxTokens ?? rec.maxTokens
  );
  return {
    localModelName: rec.modelName,
    isConfigured: computeIsConfigured({ ...state, localModelName: rec.modelName }),
    localContextSize: resolvedContextSize,
    localMaxTokens: resolvedMaxTokens,
    gpuBackendPreference: existingOverride?.gpuBackend ?? 'auto',
    localConfigAutoApplied: autoApplied,
    modelOverrides: nextOverrides,
  };
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      apiUrl: '',
      apiKey: '',
      isConfigured: false,
      hasHydrated: false,
      theme: 'berry',
      fontSize: 'medium',
      accentColor: 'berry',
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
      googleSetupPending: false,
      taskHistoryRetention: 20,

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
      modelOverrides: {},

      // Multimodal defaults (#559, #562)
      maxImagesPerMessage: 2,
      cloudPrivacyConsent: false,

      // Floating Overlay defaults (#596, #599)
      floatingOverlay: { ...DEFAULT_FLOATING_OVERLAY_CONFIG },

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
          theme: 'berry',
          fontSize: 'medium',
          accentColor: 'berry',
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
          modelOverrides: {},
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
          googleSetupPending: false,
          taskHistoryRetention: 20,
          floatingOverlay: { ...DEFAULT_FLOATING_OVERLAY_CONFIG },
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
      setGoogleSetupPending: (val) => set({ googleSetupPending: val }),
      setTaskHistoryRetention: (limit: number) => set({ taskHistoryRetention: Math.max(1, limit) }),
      
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
          localConfigAutoApplied: false,
          isConfigured: computeIsConfigured({ ...state, localModelName }),
        })),
      setLocalContextSize: (localContextSize) => set({ localContextSize, localConfigAutoApplied: false }),
      setLocalMaxTokens: (localMaxTokens) => set({ localMaxTokens, localConfigAutoApplied: false }),
      setLocalConfigAutoApplied: (localConfigAutoApplied) => set({ localConfigAutoApplied }),
      setDetectedRamBytes: (detectedRamBytes) => set({ detectedRamBytes }),
      setMaxSteps: (maxSteps) => set({ maxSteps }),
      setMaxStepsEnabled: (maxStepsEnabled) => set({ maxStepsEnabled }),
      setContextCompression: (contextCompression) => set({ contextCompression }),
      setSystemPromptEnabled: (systemPromptEnabled) => set({ systemPromptEnabled }),
      setMaxTokens: (maxTokens) => set({ maxTokens }),
      setGpuBackendPreference: (gpuBackendPreference) => set({ gpuBackendPreference, localConfigAutoApplied: false }),
      setGpuQuantPreference: (gpuQuantPreference) => set({ gpuQuantPreference }),

      // Per-model override actions (#612, #615)
      setModelOverride: (modelName, override) =>
        set((state) => {
          const existing = state.modelOverrides[modelName] ?? {};
          const merged: ModelOverrideConfig = { ...existing, ...override };
          if (merged.contextSize === undefined) delete merged.contextSize;
          if (merged.maxTokens === undefined) delete merged.maxTokens;
          if (merged.gpuBackend === undefined || merged.gpuBackend === 'auto') delete merged.gpuBackend;
          const nextOverrides = { ...state.modelOverrides };
          if (Object.keys(merged).length === 0) {
            delete nextOverrides[modelName];
          } else {
            nextOverrides[modelName] = merged;
          }
          if (state.localModelName === modelName) {
            return {
              modelOverrides: nextOverrides,
              localContextSize: override.contextSize !== undefined ? override.contextSize : state.localContextSize,
              localMaxTokens: override.maxTokens !== undefined ? override.maxTokens : state.localMaxTokens,
              gpuBackendPreference: override.gpuBackend !== undefined ? override.gpuBackend : state.gpuBackendPreference,
              localConfigAutoApplied: false,
            };
          }
          return { modelOverrides: nextOverrides };
        }),
      clearModelOverride: (modelName) =>
        set((state) => {
          const nextOverrides = { ...state.modelOverrides };
          delete nextOverrides[modelName];
          return { modelOverrides: nextOverrides };
        }),
      applyModelSettings: (modelName) =>
        set((state) => {
          const override = state.modelOverrides[modelName];
          const hasPositiveRam =
            typeof state.detectedRamBytes === 'number' &&
            Number.isFinite(state.detectedRamBytes) &&
            state.detectedRamBytes > 0;
          const tierSettings = hasPositiveRam ? getOptimalSettingsForRam(state.detectedRamBytes!) : null;
          const resolvedContextSize =
            override?.contextSize ?? tierSettings?.contextSize ?? state.localContextSize;
          const resolvedMaxTokens = clampRestoredMaxTokens(
            resolvedContextSize,
            override?.maxTokens ?? tierSettings?.maxTokens ?? state.localMaxTokens
          );
          return {
            localModelName: modelName,
            isConfigured: computeIsConfigured({ ...state, localModelName: modelName }),
            localContextSize: resolvedContextSize,
            localMaxTokens: resolvedMaxTokens,
            gpuBackendPreference: override?.gpuBackend ?? 'auto',
            localConfigAutoApplied: false,
          };
        }),
      acceptRecommendedConfig: () =>
        set((state) => applyRecommendedPreset(state, true)),
      prepareRecommendedForCustomize: () =>
        set((state) => applyRecommendedPreset(state, false)),

      // Multimodal setters (#559, #562)
      setMaxImagesPerMessage: (maxImagesPerMessage) =>
        set({
          maxImagesPerMessage: Math.max(
            1,
            Math.min(10, Math.floor(typeof maxImagesPerMessage === 'number' && !isNaN(maxImagesPerMessage) ? maxImagesPerMessage : 2))
          ),
        }),
      setCloudPrivacyConsent: (cloudPrivacyConsent) => set({ cloudPrivacyConsent }),

      // Floating Overlay setters (#596, #599)
      setFloatingOverlay: (partial) =>
        set((state) => ({
          floatingOverlay: { ...state.floatingOverlay, ...partial },
        })),
      setFloatingOverlayEnabled: (enabled) =>
        set((state) => ({
          floatingOverlay: { ...state.floatingOverlay, enabled },
        })),
      setFloatingOverlayPosition: (dockSide, dockY) =>
        set((state) => ({
          floatingOverlay: { ...state.floatingOverlay, dockSide, dockY },
        })),
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
      // v6 (PR #277 follow-up): 'Needle-2 45M' removed from LOCAL_MODELS — the
      // shipped build links exactly one Needle engine generation (gen 3), so a
      // needle2.cact can never load (`needle_load` rejects the mismatch). A
      // persisted needle2 selection moves to 'Needle-3 (20-layer)'.
      // v7 (PR #277 follow-up): every LiteRT `.task` model was replaced by a
      // GGUF equivalent (this build packages no MediaPipe engine, so `.task`
      // rows were mock-only). The two 1.5B rows lost their `.task` duplicate,
      // so a persisted selection moves to the '(GGUF)' twin. Same-name rows
      // (SmolLM 135M, Qwen2.5 0.5B, TinyLlama 1.1B) are handled by the
      // format-aware download check, which forces a re-download instead of
      // trying to load the stale `.task` file.
      // v8: "Flair" redesign (Material 3 Expressive palettes).
      // v9 (WF-447-01): scroll-craft theme roles & cold silver/chrome addition;
      // legacy oled users cleanly migrate to noir.
      // v10 (#612, #615): RAM auto-config UI & per-model overrides.
      version: 10,
      migrate: (persistedState: any, fromVersion: number) => {
        if (persistedState) {
          if (fromVersion < 10) {
            if (persistedState.modelOverrides === undefined) {
              persistedState.modelOverrides = {};
            }
            delete persistedState.detectedRamBytes;
          }
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
          if (fromVersion < 6 && persistedState.localModelName === 'Needle-2 45M') {
            persistedState.localModelName = 'Needle-3 (20-layer)';
          }
          if (fromVersion < 7) {
            // `.task` (MediaPipe) rows are gone; only their GGUF twins ship.
            const taskToGguf: Record<string, string> = {
              'Qwen2.5 1.5B': 'Qwen2.5 1.5B (GGUF)',
              'DeepSeek-R1 1.5B': 'DeepSeek-R1 1.5B (GGUF)',
            };
            const mapped = taskToGguf[persistedState.localModelName];
            if (mapped) {
              persistedState.localModelName = mapped;
            }
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
          // v8/v9: "Flair" redesign — all legacy Aurora theme names (deep/slate/
          // cyberpunk/oled/dracula/nordic/expression/vivid/matte) are retired.
          // Legacy oled users migrate directly to noir (AMOLED dark atmosphere).
          if (fromVersion < 9) {
            if ((persistedState.theme as string) === 'oled') {
              persistedState.theme = 'noir';
            }
          }
          const FLAIR_THEMES: readonly ThemeName[] = ['berry', 'citrus', 'aquatic', 'sunset', 'noir', 'chrome'];
          if (!FLAIR_THEMES.includes(persistedState.theme as ThemeName)) {
            persistedState.theme = 'berry';
          }
          if (persistedState.floatingOverlay === undefined) {
            persistedState.floatingOverlay = { ...DEFAULT_FLOATING_OVERLAY_CONFIG };
          }
        }
        return persistedState;
      },
      partialize: (state) => {
        // Exclude runtime-only probes/session state (hasHydrated, detectedRamBytes).
        const { hasHydrated, cloudApiKeys, detectedRamBytes, ...rest } = state;
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

/**
 * Single source of truth for whether the RAM-tier recommendation is currently
 * active and matches the device's recommended preset.
 */
export function selectIsRecommendationApplied(
  state: Pick<
    ConfigState,
    | 'localConfigAutoApplied'
    | 'detectedRamBytes'
    | 'localModelName'
    | 'localContextSize'
    | 'localMaxTokens'
    | 'gpuBackendPreference'
  >
): boolean {
  if (
    !state.localConfigAutoApplied ||
    typeof state.detectedRamBytes !== 'number' ||
    !Number.isFinite(state.detectedRamBytes) ||
    state.detectedRamBytes <= 0
  ) {
    return false;
  }
  const rec = getOptimalSettingsForRam(state.detectedRamBytes);
  return (
    state.localModelName === rec.modelName &&
    state.localContextSize === rec.contextSize &&
    state.localMaxTokens === rec.maxTokens &&
    state.gpuBackendPreference === 'auto'
  );
}
