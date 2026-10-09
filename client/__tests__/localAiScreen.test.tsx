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
