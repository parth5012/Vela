import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LocalAiScreen from '../app/settings/local-ai';
import { useConfigStore } from '../store/useConfigStore';
import {
  LITERT_GPU_CRASH_FLAG_KEY,
  clearGpuCrashFlag,
  isGpuCrashFlagSet,
} from '../utils/liteRtCrashFlag';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock-doc-dir/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

jest.mock('llama.rn', () => ({
  initLlama: jest.fn(),
  LlamaContext: jest.fn(),
}));

jest.mock('../modules/needle', () => ({
  hasNativeLibrary: jest.fn(() => false),
  init: jest.fn(async () => false),
  unload: jest.fn(async () => {}),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  complete: jest.fn(async () => ({ text: '' })),
}));

jest.mock('../modules/stable-diffusion', () => ({
  getGpuInfo: jest.fn(async () => ({ hardware: 'qcom', vendor: 'adreno' })),
}));

jest.mock('../utils/ramDetection', () => {
  const actual = jest.requireActual('../utils/ramDetection');
  return {
    ...actual,
    // Mirrors prod fail-closed behavior: 0 unless emulator/simulation is explicitly allowed.
    detectRamBytes: jest.fn(async (options?: { allowEmulator?: boolean }) =>
      options?.allowEmulator ? 6 * 1024 * 1024 * 1024 : 0
    ),
  };
});

describe('LocalAiScreen RAM Display (fail-closed detectRamBytes)', () => {
  // Track the mounted renderer so it unsubscribes from the store between
  // tests; otherwise a leftover instance re-runs its RAM effect during the
  // next test's clearConfig() and pollutes detectRamBytes call assertions.
  let mounted: renderer.ReactTestRenderer | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    act(() => {
      useConfigStore.getState().clearConfig();
    });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  it('requests RAM with allowEmulator so the display never shows 0.0 GB', async () => {
    const { detectRamBytes } = require('../utils/ramDetection');

    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    mounted = component;

    expect(detectRamBytes).toHaveBeenCalledWith({ allowEmulator: true });

    const allTextNodes = component!.root.findAllByType('Text' as any);
    const combinedText = allTextNodes
      .map((n) => n.props.children)
      .flat()
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(combinedText).toContain('Device RAM: 6.0 GB');
    expect(combinedText).not.toContain('Device RAM: 0.0 GB');
  });

  it('does not simulate 6 GB RAM on a production Android build', async () => {
    const { detectRamBytes } = require('../utils/ramDetection');
    const { Platform } = require('react-native');

    const originalDev = (global as { __DEV__?: boolean }).__DEV__;
    const originalOs = (Platform as { OS?: string }).OS;
    // Simulate a release Android build where the display must not lie about RAM.
    (global as { __DEV__?: boolean }).__DEV__ = false;
    (Platform as { OS?: string }).OS = 'android';

    try {
      let component: renderer.ReactTestRenderer | undefined;
      await act(async () => {
        component = renderer.create(<LocalAiScreen />);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      mounted = component;

      expect(detectRamBytes).toHaveBeenCalledWith({ allowEmulator: false });
    } finally {
      (global as { __DEV__?: boolean }).__DEV__ = originalDev;
      (Platform as { OS?: string }).OS = originalOs;
    }
  });
});

describe('LocalAiScreen LiteRT Crash Badge', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearGpuCrashFlag();
    act(() => {
      useConfigStore.getState().clearConfig();
      useConfigStore.getState().setDetectedRamBytes(6 * 1024 * 1024 * 1024);
    });
  });

  afterEach(async () => {
    await clearGpuCrashFlag();
  });

  it('renders GPU crash badge when crash flag is present and removes it on clear', async () => {
    // 1. Seed crash flag
    await AsyncStorage.setItem(
      LITERT_GPU_CRASH_FLAG_KEY,
      JSON.stringify({
        backend: 'opencl',
        modelName: 'Qwen2.5 0.5B',
        timestamp: Date.now(),
      })
    );

    let component: renderer.ReactTestRenderer | undefined;

    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
      // Allow useEffect to read crash flag details
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const root = component!.root;

    // Verify badge elements are present
    const alertBox = root.findByProps({ accessibilityRole: 'alert' });
    expect(alertBox).toBeDefined();

    const allTextNodes = root.findAllByType('Text' as any);
    const combinedText = allTextNodes.map((n) => n.props.children).flat().join(' ');
    expect(combinedText).toContain('GPU Crash Detected');
    expect(combinedText).toContain('CPU-Safe Fallback');
    expect(combinedText).toContain(
      'LiteRT hit a GPU crash — running on CPU for this session. GPU will be retried next launch.'
    );
    expect(combinedText).toContain('Mock honesty');

    // Find the Clear button
    const clearButton = root.findByProps({ accessibilityLabel: 'Clear GPU crash flag' });
    expect(clearButton).toBeDefined();

    // 2. Click clear button
    await act(async () => {
      clearButton.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Crash flag must be cleared from storage
    expect(await isGpuCrashFlagSet()).toBe(false);

    // Alert badge should now be removed from render tree
    const remainingAlerts = root.findAllByProps({ accessibilityRole: 'alert' });
    expect(remainingAlerts.length).toBe(0);
  });

  it('does not render crash badge when no crash flag is set', async () => {
    let component: renderer.ReactTestRenderer | undefined;

    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const root = component!.root;
    const alertBoxes = root.findAllByProps({ accessibilityRole: 'alert' });
    expect(alertBoxes.length).toBe(0);
  });
});
