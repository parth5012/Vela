import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SetupScreen from '../app/setup';
import { useConfigStore } from '../store/useConfigStore';
import * as Notifications from 'expo-notifications';
import { registerAndPostToken } from '../utils/pushRegistration';
import { getMissingSetupPermissions } from '../utils/setupPermissions';

// #556: the wizard owns push registration when notifications are granted.
jest.mock('../utils/pushRegistration', () => ({
  registerAndPostToken: jest.fn(async () => 'ExponentPushToken[test-token]'),
}));

// Mock expo-router
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

// Per-test override of the global always-granted expo-notifications mock
// (same pattern as checkIn.test.ts).
const notificationMocks = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
};

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
    jest.clearAllMocks();
    notificationMocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    notificationMocks.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    useConfigStore.getState().clearConfig();
    (globalThis as any).fetch = jest.fn();
  });

  // Walks up from a Text node to the nearest Pressable with onPress and presses it.
  const pressButtonWithText = async (root: any, text: string) => {
    const textNode = root.find(
      (node: any) => node.type === 'Text' && node.children.includes(text)
    );
    let button = textNode;
    while (button && !button.props.onPress) {
      button = button.parent;
    }
    expect(button).toBeDefined();
    await act(async () => {
      await button.props.onPress();
    });
  };

  // Fork → server form → verified → the permissions step (#556).
  const reachPermissionsStepViaServer = async (root: any) => {
    await pressButtonWithText(root, 'Connect to Server');
    const textInputs = root.findAllByType('TextInput');
    act(() => {
      textInputs[0].props.onChangeText('https://api.vela.local');
      textInputs[1].props.onChangeText('test-key');
    });
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    await pressButtonWithText(root, 'Connect & Save');
  };

  it('should call setConfig on successful 200 response for server path', async () => {
    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });

    const root = component.root;
    await reachPermissionsStepViaServer(root);

    // #556: after verification the wizard shows the permissions step, NOT the
    // chat — config is only finalized when the user finishes the permissions
    // step (the connection state itself is stashed, not applied).
    expect(useConfigStore.getState().isConfigured).toBe(false);
    expect(root.find((node: any) => node.type === 'Text' && node.children.includes('Finish setup'))).toBeDefined();
    expect(root.find((node: any) => node.type === 'Text' && node.children.includes('Notifications'))).toBeDefined();

    await pressButtonWithText(root, 'Finish setup');

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

    // #556: the wizard now shows the permissions step before finishing.
    await pressButtonWithText(root, 'Finish setup');

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

    // #556: the wizard now shows the permissions step before finishing.
    await pressButtonWithText(root, 'Finish setup');

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

  // ------------------------------------------------------------------
  // #556: onboarding permissions step
  // ------------------------------------------------------------------
  it('renders independent permission rows with rationales and accessibility entry', async () => {
    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;
    await reachPermissionsStepViaServer(root);

    // Three independent OS-dialog rows, notifications → camera → microphone
    expect(root.find((node: any) => node.props.accessibilityLabel === 'Allow notifications')).toBeDefined();
    expect(root.find((node: any) => node.props.accessibilityLabel === 'Allow camera')).toBeDefined();
    expect(root.find((node: any) => node.props.accessibilityLabel === 'Allow microphone')).toBeDefined();
    // Each row has a "Not now" skip
    expect(root.find((node: any) => node.props.accessibilityLabel === 'Not now camera')).toBeDefined();
    // Accessibility is offered through the guide, not an OS dialog
    expect(root.find((node: any) => node.props.accessibilityLabel === 'Set up accessibility')).toBeDefined();
    expect(root.find((node: any) => node.type === 'Text' && node.children.includes('Notifications'))).toBeDefined();
  });

  it('grant path: allowing notifications persists granted and Finish triggers registerAndPostToken', async () => {
    notificationMocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    notificationMocks.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });

    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;
    await reachPermissionsStepViaServer(root);

    // Allow fires the OS dialog via requestPermission and persists the outcome.
    const allowBtn = root.find((node: any) => node.props.accessibilityLabel === 'Allow notifications');
    let button = allowBtn;
    while (button && !button.props.onPress) {
      button = button.parent;
    }
    await act(async () => {
      await button.props.onPress();
    });
    expect(notificationMocks.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(useConfigStore.getState().osPermissions.notifications).toBe('granted');

    // Finishing finalizes the server config and runs push registration from
    // the wizard path (no silent prompt anywhere else).
    await pressButtonWithText(root, 'Finish setup');

    expect(useConfigStore.getState().isConfigured).toBe(true);
    expect(useConfigStore.getState().connectionMode).toBe('server');
    expect(registerAndPostToken).toHaveBeenCalledTimes(1);
    expect(getMissingSetupPermissions(useConfigStore.getState().osPermissions)).toEqual([]);
  });

  it('skip path: "Not now" skips only that permission and does not register push', async () => {
    notificationMocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;
    await reachPermissionsStepViaServer(root);

    const skipBtn = root.find((node: any) => node.props.accessibilityLabel === 'Not now notifications');
    let button = skipBtn;
    while (button && !button.props.onPress) {
      button = button.parent;
    }
    await act(async () => {
      await button.props.onPress();
    });

    // Skipped — never asked, nothing to register, outcome persisted honestly.
    expect(notificationMocks.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(useConfigStore.getState().osPermissions.notifications).toBe('undetermined');

    await pressButtonWithText(root, 'Finish setup');

    expect(useConfigStore.getState().isConfigured).toBe(true);
    expect(registerAndPostToken).not.toHaveBeenCalled();
  });

  it('denied path: OS denial is persisted and Finish does not register push', async () => {
    notificationMocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    notificationMocks.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;
    await reachPermissionsStepViaServer(root);

    const allowBtn = root.find((node: any) => node.props.accessibilityLabel === 'Allow notifications');
    let button = allowBtn;
    while (button && !button.props.onPress) {
      button = button.parent;
    }
    await act(async () => {
      await button.props.onPress();
    });
    expect(useConfigStore.getState().osPermissions.notifications).toBe('denied');

    await pressButtonWithText(root, 'Finish setup');

    expect(useConfigStore.getState().isConfigured).toBe(true);
    expect(registerAndPostToken).not.toHaveBeenCalled();
    // Banner logic: the denied notification counts as missing setup.
    expect(getMissingSetupPermissions(useConfigStore.getState().osPermissions)).toEqual([
      'notifications',
    ]);
  });

  it('is never blocked: Finish is available without touching any permission', async () => {
    let component: any;
    act(() => {
      component = renderer.create(<SetupScreen />);
    });
    const root = component.root;
    await reachPermissionsStepViaServer(root);

    // No permission touched at all — Finish still completes the setup.
    expect(notificationMocks.requestPermissionsAsync).not.toHaveBeenCalled();
    await pressButtonWithText(root, 'Finish setup');
    expect(useConfigStore.getState().isConfigured).toBe(true);
    expect(registerAndPostToken).not.toHaveBeenCalled();
  });
});
