jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockSecureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key) => mockSecureStore[key] || null),
  setItemAsync: jest.fn(async (key, value) => {
    mockSecureStore[key] = value;
  }),
  deleteItemAsync: jest.fn(async (key) => {
    delete mockSecureStore[key];
  }),
}));

import { useConfigStore } from '../store/useConfigStore';

describe('useConfigStore', () => {
  beforeEach(() => {
    mockSecureStore = {};
    useConfigStore.getState().clearConfig();
  });

  it('should initialize with blank values and allow setting config', () => {
    const state = useConfigStore.getState();
    expect(state.apiUrl).toBe('');
    expect(state.apiKey).toBe('');
    expect(state.isConfigured).toBe(false);

    state.setConfig('https://api.vela.local', 'my-secret-key');

    const updatedState = useConfigStore.getState();
    expect(updatedState.apiUrl).toBe('https://api.vela.local');
    expect(updatedState.apiKey).toBe('my-secret-key');
    expect(updatedState.isConfigured).toBe(true);

    // Test clearConfig
    updatedState.clearConfig();
    const clearedState = useConfigStore.getState();
    expect(clearedState.apiUrl).toBe('');
    expect(clearedState.apiKey).toBe('');
    expect(clearedState.isConfigured).toBe(false);
  });

  it('should initialize with default values for UI customizations and agent parameters', () => {
    const state = useConfigStore.getState();
    expect(state.theme).toBe('deep');
    expect(state.fontSize).toBe('medium');
    expect(state.accentColor).toBe('indigo');
    expect(state.systemPrompt).toBe('You are an autonomous research agent.');
    expect(state.temperature).toBe(0.7);
    expect(state.modelName).toBe('gemini-1.5-pro');
    expect(state.maxSteps).toBe(15);
    expect(state.maxStepsEnabled).toBe(true);
  });

  it('should allow updating maxSteps and maxStepsEnabled via setters', () => {
    const state = useConfigStore.getState();
    state.setMaxSteps(25);
    state.setMaxStepsEnabled(false);

    const updatedState = useConfigStore.getState();
    expect(updatedState.maxSteps).toBe(25);
    expect(updatedState.maxStepsEnabled).toBe(false);

    updatedState.clearConfig();
    const clearedState = useConfigStore.getState();
    expect(clearedState.maxSteps).toBe(15);
    expect(clearedState.maxStepsEnabled).toBe(true);
  });

  it('should allow updating UI customizations and agent parameters via setters', () => {
    const state = useConfigStore.getState();
    
    state.setTheme('cyberpunk');
    state.setFontSize('large');
    state.setAccentColor('rose');
    state.setSystemPrompt('Hello world');
    state.setTemperature(0.9);
    state.setModelName('gemini-1.5-flash');

    const updatedState = useConfigStore.getState();
    expect(updatedState.theme).toBe('cyberpunk');
    expect(updatedState.fontSize).toBe('large');
    expect(updatedState.accentColor).toBe('rose');
    expect(updatedState.systemPrompt).toBe('Hello world');
    expect(updatedState.temperature).toBe(0.9);
    expect(updatedState.modelName).toBe('gemini-1.5-flash');
  });

  it('should initialize default values for connection mode and cloud providers', () => {
    const state = useConfigStore.getState();
    expect(state.connectionMode).toBe('server');
    expect(state.activeCloudProvider).toBe('gemini');
    expect(state.cloudProviders.gemini).toBeDefined();
    expect(state.cloudProviders.gemini.model).toBe('gemini-1.5-flash');
    expect(state.cloudProviders.openai.model).toBe('gpt-4o-mini');
  });

  it('should allow updating connection mode and cloud provider settings', async () => {
    const state = useConfigStore.getState();
    state.setConnectionMode('cloud');
    state.setActiveCloudProvider('anthropic');
    state.setCloudProviderConfig('anthropic', { model: 'claude-3-7-sonnet' });
    await state.setCloudApiKey('anthropic', 'sk-ant-test');

    const updatedState = useConfigStore.getState();
    expect(updatedState.connectionMode).toBe('cloud');
    expect(updatedState.activeCloudProvider).toBe('anthropic');
    expect(updatedState.cloudProviders.anthropic.model).toBe('claude-3-7-sonnet');
    expect(updatedState.cloudApiKeys.anthropic).toBe('sk-ant-test');
    expect(mockSecureStore['vela-key-anthropic']).toBe('sk-ant-test');

    await state.deleteCloudApiKey('anthropic');
    expect(useConfigStore.getState().cloudApiKeys.anthropic).toBeUndefined();
    expect(mockSecureStore['vela-key-anthropic']).toBeUndefined();
  });

  it('migrates legacy isLocalMode === true to connectionMode local in v3 migrate', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { connectionMode, ...legacyState } = useConfigStore.getState();

    await AsyncStorage.setItem(
      'vela-config-storage',
      JSON.stringify({
        state: {
          ...legacyState,
          isLocalMode: true,
        },
        version: 2,
      })
    );

    await useConfigStore.persist.rehydrate();
    expect(useConfigStore.getState().connectionMode).toBe('local');

    await AsyncStorage.removeItem('vela-config-storage');
    useConfigStore.getState().clearConfig();
  });

  it('migrates legacy isLocalMode === false to connectionMode server in v3 migrate', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { connectionMode, ...legacyState } = useConfigStore.getState();

    await AsyncStorage.setItem(
      'vela-config-storage',
      JSON.stringify({
        state: {
          ...legacyState,
          isLocalMode: false,
        },
        version: 2,
      })
    );

    await useConfigStore.persist.rehydrate();
    expect(useConfigStore.getState().connectionMode).toBe('server');

    await AsyncStorage.removeItem('vela-config-storage');
    useConfigStore.getState().clearConfig();
  });

  it('evaluates isConfigured correctly for each connection mode', async () => {
    const state = useConfigStore.getState();

    // server mode: requires apiUrl and apiKey
    state.setConnectionMode('server');
    expect(useConfigStore.getState().isConfigured).toBe(false);
    state.setConfig('https://example.com', 'server-key');
    expect(useConfigStore.getState().isConfigured).toBe(true);

    // local mode: requires localModelName
    state.setConnectionMode('local');
    expect(useConfigStore.getState().isConfigured).toBe(true);
    state.setLocalModelName('');
    expect(useConfigStore.getState().isConfigured).toBe(false);
    state.setLocalModelName('DeepSeek-R1 1.5B (GGUF)');
    expect(useConfigStore.getState().isConfigured).toBe(true);

    // cloud mode: requires active provider model and apiKey
    state.setConnectionMode('cloud');
    state.setActiveCloudProvider('gemini');
    expect(useConfigStore.getState().isConfigured).toBe(false);
    await state.setCloudApiKey('gemini', 'gemini-key');
    expect(useConfigStore.getState().isConfigured).toBe(true);

    // custom provider: requires baseUrl in addition to model and apiKey
    state.setActiveCloudProvider('custom');
    state.setCloudProviderConfig('custom', { model: 'llama-3' });
    await state.setCloudApiKey('custom', 'custom-key');
    expect(useConfigStore.getState().isConfigured).toBe(false); // missing baseUrl
    state.setCloudProviderConfig('custom', { baseUrl: 'https://custom.llm/v1' });
    expect(useConfigStore.getState().isConfigured).toBe(true);
  });

  it('should initialize default values for local mode config', () => {
    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('DeepSeek-R1 1.5B (GGUF)');
    expect(state.connectionMode).toBe('server');
    expect(state.localModelDownloadProgress).toBeNull();
    expect(state.wifiOnlyDownload).toBe(true);
    expect(state.localContextSize).toBe(2048);
    expect(state.localMaxTokens).toBe(512);
    expect(state.localConfigAutoApplied).toBe(false);
    expect(state.detectedRamBytes).toBeNull();
  });

  it('should allow updating local mode config via setters', () => {
    const state = useConfigStore.getState();
    state.setLocalModelName('Phi-3 Mini');
    state.setConnectionMode('local');
    state.setLocalModelDownloadProgress(50);
    state.setWifiOnlyDownload(false);
    state.setLocalContextSize(1024);
    state.setLocalMaxTokens(256);
    state.setLocalConfigAutoApplied(true);
    state.setDetectedRamBytes(4000000000);

    const updatedState = useConfigStore.getState();
    expect(updatedState.localModelName).toBe('Phi-3 Mini');
    expect(updatedState.connectionMode).toBe('local');
    expect(updatedState.localModelDownloadProgress).toBe(50);
    expect(updatedState.wifiOnlyDownload).toBe(false);
    expect(updatedState.localContextSize).toBe(1024);
    expect(updatedState.localMaxTokens).toBe(256);
    expect(updatedState.localConfigAutoApplied).toBe(true);
    expect(updatedState.detectedRamBytes).toBe(4000000000);
  });

  // #294 — 'Cactus Needle 45M' was hard-migrated to the live Cactus-Compute
  // needle2/needle3 entries (its old HF URL is dead, HTTP 401). A
  // persisted v1 selection of the removed name must fall back to the default,
  // never crash or leave local mode pointing at a model that no longer exists.
  it('resets a persisted stale "Cactus Needle 45M" selection on rehydrate (v1 → v2 migrate)', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(
      'vela-config-storage',
      JSON.stringify({
        state: {
          ...useConfigStore.getState(),
          localModelName: 'Cactus Needle 45M',
          isLocalMode: true,
        },
        version: 1,
      })
    );

    await useConfigStore.persist.rehydrate();

    expect(useConfigStore.getState().localModelName).toBe('DeepSeek-R1 1.5B (GGUF)');
    expect(useConfigStore.getState().connectionMode).toBe('server');

    // Cleanup: drop the seeded payload and restore defaults for later tests.
    await AsyncStorage.removeItem('vela-config-storage');
    useConfigStore.setState({
      localModelName: 'DeepSeek-R1 1.5B (GGUF)',
      connectionMode: 'server',
    });
  });

  it('should default tap/type/swipe device permissions to confirm (audit fix regression guard)', () => {
    const perms = useConfigStore.getState().deviceAgentPermissions;
    // These three were downgraded from 'auto' to 'confirm' in the audit fix:
    expect(perms.tap).toBe('confirm');
    expect(perms.type).toBe('confirm');
    expect(perms.swipe).toBe('confirm');
    // Negative contrast: read-only actions stay automatic, destructive stay denied.
    expect(perms.screenshot).toBe('auto');
    expect(perms.passwords_otps).toBe('deny');
  });

  it('should update a single device agent permission without touching others', () => {
    useConfigStore.getState().setDeviceAgentPermission('tap', 'deny');
    const perms = useConfigStore.getState().deviceAgentPermissions;
    expect(perms.tap).toBe('deny');
    expect(perms.type).toBe('confirm'); // untouched
    expect(Object.keys(perms).length).toBe(20); // no categories lost
  });

  it('should have default suggestion starters', () => {
    const state = useConfigStore.getState();
    expect(state.suggestionStarters.length).toBe(3);
    expect(state.suggestionStarters[0].label).toBe('👩🏫 Teach Concept');
  });

  it('should update suggestion starters correctly', () => {
    useConfigStore.getState().setSuggestionStarters([
      { label: 'Test Label', text: 'Test text', agent: 'teacher' }
    ]);
    expect(useConfigStore.getState().suggestionStarters.length).toBe(1);
    expect(useConfigStore.getState().suggestionStarters[0].label).toBe('Test Label');
  });

  it('should store apiKey securely in SecureStore and strip it from AsyncStorage', async () => {
    const state = useConfigStore.getState();
    state.setConfig('https://api.vela.local', 'my-secret-key');

    // Allow async persistence storage calls to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify SecureStore has the token
    expect(mockSecureStore['vela-api-key']).toBe('my-secret-key');

    // Verify AsyncStorage has the structure but key is stripped
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const asyncStorageVal = await AsyncStorage.getItem('vela-config-storage');
    expect(asyncStorageVal).not.toBeNull();
    const parsed = JSON.parse(asyncStorageVal);
    expect(parsed.state.apiKey).toBe('');
    expect(parsed.state.apiUrl).toBe('https://api.vela.local');
  });
});
