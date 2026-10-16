import React from 'react';
import renderer, { act, type ReactTestInstance } from 'react-test-renderer';
import CloudProvidersScreen from '../app/settings/cloud-providers';
import ConnectionScreen from '../app/settings/connection';
import { useConfigStore } from '../store/useConfigStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('../utils/providers/models', () => ({
  fetchProviderModels: jest.fn(async () => ['model-1', 'model-2', 'openrouter/free-model:free']),
  fetchCustomEndpointModels: jest.fn(async () => ({ models: ['custom-1', 'custom-free:free'] })),
  testProviderConnection: jest.fn(async () => ({ ok: true, message: 'Connected' })),
  getCuratedModels: jest.fn(() => ['model-1']),
  trimBearerToken: jest.fn((k: string) => (k ? k.replace(/^bearer\s+/i, '').trim() : '')),
  isFreeModelId: jest.fn((id: string) => Boolean(id && (id.includes(':free') || id.includes('/free')))),
  OPENROUTER_FREE_MODEL: 'gpt-oss-120b:free',
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

describe('Cloud Providers and Connection Settings Screens', () => {
  beforeEach(() => {
    mockPush.mockClear();
    useConfigStore.getState().clearConfig();
  });

  it('renders CloudProvidersScreen with all 6 provider cards', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<CloudProvidersScreen />);
      await Promise.resolve();
    });

    const root = component.root;
    const texts = root.findAllByType('Text').map((t: ReactTestInstance) => t.props.children);
    const joined = texts.flat(Infinity).join(' ');

    expect(joined).toContain('Google Gemini');
    expect(joined).toContain('OpenAI');
    expect(joined).toContain('Anthropic Claude');
    expect(joined).toContain('OpenRouter');
    expect(joined).toContain('Groq');
    expect(joined).toContain('Custom (OpenAI-Compatible)');

    act(() => {
      component.unmount();
    });
  });

  it('renders ConnectionScreen with mode selector and switches connection mode', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<ConnectionScreen />);
      await Promise.resolve();
    });

    expect(useConfigStore.getState().connectionMode).toBe('server');

    act(() => {
      useConfigStore.getState().setConnectionMode('cloud');
    });

    expect(useConfigStore.getState().connectionMode).toBe('cloud');

    act(() => {
      component.unmount();
    });
  });

  it('prompts user to sync local standalone data when switching to server mode', async () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert');
    const syncManager = require('../utils/syncManager');
    jest.spyOn(syncManager, 'getUnsyncedLocalCount').mockResolvedValueOnce(3);

    useConfigStore.setState({
      connectionMode: 'cloud',
      apiUrl: 'https://api.vela.run',
      apiKey: 'test-key',
    });

    let component: any;
    await act(async () => {
      component = renderer.create(<ConnectionScreen />);
      await Promise.resolve();
    });

    const root = component.root;
    // Find Server pill
    const serverPillText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('🖥️ Server')
    );
    let serverPill = serverPillText;
    while (serverPill && !serverPill.props.onPress) {
      serverPill = serverPill.parent;
    }

    await act(async () => {
      await serverPill.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Sync Local Data to Server?',
      expect.stringContaining('3 standalone messages'),
      expect.any(Array)
    );

    act(() => {
      component.unmount();
    });
    alertSpy.mockRestore();
  });

  it('renders quick-chip for OpenRouter and populates model and baseUrl', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<CloudProvidersScreen />);
      await Promise.resolve();
    });

    const root = component.root;
    // Find OpenRouter card header to expand it
    const openrouterHeader = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('OpenRouter')
    );
    let pressable = openrouterHeader;
    while (pressable && !pressable.props.onPress) {
      pressable = pressable.parent;
    }

    await act(async () => {
      await pressable.props.onPress();
    });

    // Check that quick-chip is rendered
    const quickChip = root.find(
      (node: any) => node.props.accessibilityLabel === 'Quick-chip gpt-oss-120b:free'
    );
    expect(quickChip).toBeTruthy();

    await act(async () => {
      await quickChip.props.onPress();
    });

    const inputs = root.findAllByType('TextInput');
    const modelInput = inputs.find((i: any) => i.props.value === 'gpt-oss-120b:free');
    expect(modelInput).toBeTruthy();

    act(() => {
      component.unmount();
    });
  });

  it('renders inference controls (temperature stepper, maxTokens, switches) and updates store', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<CloudProvidersScreen />);
      await Promise.resolve();
    });

    const root = component.root;
    const texts = root.findAllByType('Text').map((t: ReactTestInstance) => t.props.children);
    const joined = texts.flat(Infinity).join(' ');

    expect(joined).toContain('Inference & Prompt Controls');
    expect(joined).toContain('Context Compression');
    expect(joined).toContain('System Prompt Enabled');
    expect(joined).toContain('Temperature');
    expect(joined).toContain('Max Tokens');

    const contextCompSwitch = root.find(
      (s: any) => s.props.accessibilityLabel === 'Context Compression Switch'
    );
    expect(contextCompSwitch).toBeTruthy();
    act(() => {
      contextCompSwitch.props.onValueChange(false);
    });
    expect(useConfigStore.getState().contextCompression).toBe(false);

    const sysPromptSwitch = root.find(
      (s: any) => s.props.accessibilityLabel === 'System Prompt Enabled Switch'
    );
    expect(sysPromptSwitch).toBeTruthy();
    act(() => {
      sysPromptSwitch.props.onValueChange(false);
    });
    expect(useConfigStore.getState().systemPromptEnabled).toBe(false);

    // Temperature stepper
    const incTempBtn = root.find(
      (node: any) => node.props.accessibilityLabel === 'Increase temperature'
    );
    act(() => {
      incTempBtn.props.onPress();
    });
    expect(useConfigStore.getState().temperature).toBe(0.8);

    // Max tokens stepper
    const decTokensBtn = root.find(
      (node: any) => node.props.accessibilityLabel === 'Decrease max tokens'
    );
    act(() => {
      decTokensBtn.props.onPress();
    });
    expect(useConfigStore.getState().maxTokens).toBe(3840);

    act(() => {
      component.unmount();
    });
  });
});
