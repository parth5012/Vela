import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SetupScreen from '../app/setup';
import { useConfigStore } from '../store/useConfigStore';

// Mock expo-router
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// SetupScreen -> syncHistoryWithBackend -> useChatStore -> db/client, which
// loads expo-sqlite (unavailable in jest). Stub the db layer; null db makes
// repository calls no-op.
jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

// Mock SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

describe('SetupScreen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    useConfigStore.getState().clearConfig();
    (globalThis as any).fetch = jest.fn();
  });

  it('should call setConfig on successful 200 response for server path', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    (globalThis as any).fetch = mockFetch;

    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });

    const root = component.root;

    // Click "Connect to Server" card/button to enter server configuration step
    const serverBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Connect to Server')
    );
    let serverBtn = serverBtnText;
    while (serverBtn && !serverBtn.props.onPress) {
      serverBtn = serverBtn.parent;
    }
    expect(serverBtn).toBeDefined();

    await act(async () => {
      await serverBtn.props.onPress();
    });

    // Find Inputs
    const textInputs = root.findAllByType('TextInput');
    expect(textInputs.length).toBe(2);

    // Simulate entering API URL and API Key
    act(() => {
      textInputs[0].props.onChangeText('https://api.vela.local');
      textInputs[1].props.onChangeText('test-key');
    });

    // Find Connect button by looking for text "Connect & Save" and walking up to find onPress
    const textNode = root.find((node: any) => node.type === 'Text' && node.children.includes('Connect & Save'));
    let button = textNode;
    while (button && !button.props.onPress) {
      button = button.parent;
    }
    expect(button).toBeDefined();

    // Press the button
    await act(async () => {
      await button.props.onPress();
    });

    // Verify fetch was called with correct arguments
    expect(mockFetch).toHaveBeenCalledWith('https://api.vela.local/health', expect.any(Object));

    // Verify useConfigStore has been updated
    const configState = useConfigStore.getState();
    expect(configState.isConfigured).toBe(true);
    expect(configState.connectionMode).toBe('server');
    expect(configState.apiUrl).toBe('https://api.vela.local');
    expect(configState.apiKey).toBe('test-key');

    // Verify router.replace was not called directly from SetupScreen (redirection is handled reactively by RootLayout)
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('configures standalone cloud mode after entering API key and verifying', async () => {
    const modelsModule = require('../utils/providers/models');
    jest.spyOn(modelsModule, 'testProviderConnection').mockResolvedValueOnce({
      ok: true,
      message: 'Verified',
    });

    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });

    const root = component.root;

    // Click "Run Standalone" card/button
    const standaloneBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Run Standalone')
    );
    let standaloneBtn = standaloneBtnText;
    while (standaloneBtn && !standaloneBtn.props.onPress) {
      standaloneBtn = standaloneBtn.parent;
    }
    expect(standaloneBtn).toBeDefined();

    await act(async () => {
      await standaloneBtn.props.onPress();
    });

    // Choose "Cloud APIs" option
    const cloudBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Cloud APIs')
    );
    let cloudBtn = cloudBtnText;
    while (cloudBtn && !cloudBtn.props.onPress) {
      cloudBtn = cloudBtn.parent;
    }
    expect(cloudBtn).toBeDefined();

    await act(async () => {
      await cloudBtn.props.onPress();
    });

    // Find API Key input (first input is API Key, second is Model Name)
    const textInputs = root.findAllByType('TextInput');
    act(() => {
      textInputs[0].props.onChangeText('sk-gemini-test-key');
    });

    // Press "Test & Start" button
    const testStartText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Test & Start')
    );
    let testStartBtn = testStartText;
    while (testStartBtn && !testStartBtn.props.onPress) {
      testStartBtn = testStartBtn.parent;
    }

    await act(async () => {
      await testStartBtn.props.onPress();
    });

    const configState = useConfigStore.getState();
    expect(configState.connectionMode).toBe('cloud');
    expect(configState.activeCloudProvider).toBe('gemini');
    expect(configState.cloudApiKeys.gemini).toBe('sk-gemini-test-key');
    expect(configState.isConfigured).toBe(true);
  });

  it('configures standalone local AI mode', async () => {
    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });

    const root = component.root;

    // Click "Run Standalone" card/button
    const standaloneBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Run Standalone')
    );
    let standaloneBtn = standaloneBtnText;
    while (standaloneBtn && !standaloneBtn.props.onPress) {
      standaloneBtn = standaloneBtn.parent;
    }

    await act(async () => {
      await standaloneBtn.props.onPress();
    });

    // Choose "On-Device Local AI" option
    const localBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('On-Device Local AI')
    );
    let localBtn = localBtnText;
    while (localBtn && !localBtn.props.onPress) {
      localBtn = localBtn.parent;
    }
    expect(localBtn).toBeDefined();

    await act(async () => {
      await localBtn.props.onPress();
    });

    // Press "Start with Local AI"
    const startLocalText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Start with Local AI')
    );
    let startLocalBtn = startLocalText;
    while (startLocalBtn && !startLocalBtn.props.onPress) {
      startLocalBtn = startLocalBtn.parent;
    }

    await act(async () => {
      await startLocalBtn.props.onPress();
    });

    const configState = useConfigStore.getState();
    expect(configState.connectionMode).toBe('local');
    expect(configState.isConfigured).toBe(true);
  });

  it('allows navigating back from server step to fork screen', async () => {
    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;

    // Go to server step
    const serverBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Connect to Server')
    );
    let serverBtn = serverBtnText;
    while (serverBtn && !serverBtn.props.onPress) {
      serverBtn = serverBtn.parent;
    }
    await act(async () => {
      await serverBtn.props.onPress();
    });

    // Check we have text inputs
    expect(root.findAllByType('TextInput').length).toBe(2);

    // Find and press Back button
    const backBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('‹ Back')
    );
    let backBtn = backBtnText;
    while (backBtn && !backBtn.props.onPress) {
      backBtn = backBtn.parent;
    }
    await act(async () => {
      await backBtn.props.onPress();
    });

    // Back at fork step: no text inputs, but "Run Standalone" card visible
    expect(root.findAllByType('TextInput').length).toBe(0);
    const standaloneText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Run Standalone')
    );
    expect(standaloneText).toBeDefined();
  });

  it('displays error on failed server connection', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    (globalThis as any).fetch = mockFetch;

    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;

    // Go to server step
    const serverBtnText = root.find(
      (node: any) => node.type === 'Text' && node.children.includes('Connect to Server')
    );
    let serverBtn = serverBtnText;
    while (serverBtn && !serverBtn.props.onPress) {
      serverBtn = serverBtn.parent;
    }
    await act(async () => {
      await serverBtn.props.onPress();
    });

    const textInputs = root.findAllByType('TextInput');
    act(() => {
      textInputs[0].props.onChangeText('https://api.vela.local');
      textInputs[1].props.onChangeText('wrong-key');
    });

    const connectText = root.find((node: any) => node.type === 'Text' && node.children.includes('Connect & Save'));
    let button = connectText;
    while (button && !button.props.onPress) {
      button = button.parent;
    }

    await act(async () => {
      await button.props.onPress();
    });

    const errorText = root.find((node: any) => node.props.style === 259 || (node.props.children && String(node.props.children).includes('Failed to connect')));
    expect(errorText).toBeDefined();
    expect(useConfigStore.getState().isConfigured).toBe(false);
  });
});
