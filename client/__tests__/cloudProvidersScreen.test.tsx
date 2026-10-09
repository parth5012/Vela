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
  fetchProviderModels: jest.fn(async () => ['model-1', 'model-2']),
  testProviderConnection: jest.fn(async () => ({ ok: true, message: 'Connected' })),
  getCuratedModels: jest.fn(() => ['model-1']),
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
});
