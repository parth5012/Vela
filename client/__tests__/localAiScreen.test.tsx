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

/**
 * Flush async effects until `condition` holds, bounded so a genuinely
 * broken render fails instead of hanging a worker. Every store/local
 * setState lands inside act() — fixed 50ms sleeps raced under full-suite
 * worker contention (BUG-client-001).
 */
async function flushUntil(
  condition: () => boolean,
  { timeoutMs = 3000, intervalMs = 10 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let ok = condition();
  while (!ok && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    });
    ok = condition();
  }
  return ok;
}

function combinedText(component: renderer.ReactTestRenderer): string {
  return component.root
    .findAllByType('Text' as any)
    .map((n) => n.props.children)
    .flat()
    .join(' ')
    .replace(/\s+/g, ' ');
}

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
    if (mounted) {
      act(() => {
        mounted!.unmount();
      });
      mounted = undefined;
    }
  });

  it('requests RAM with allowEmulator so the display never shows 0.0 GB', async () => {
    const { detectRamBytes } = require('../utils/ramDetection');

    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
    });
    mounted = component;

    // detectRamBytes resolves async into the store, then the readout
    // re-renders; poll for the rendered value rather than a fixed sleep.
    expect(
      await flushUntil(() => combinedText(component!).includes('Device RAM: 6.0 GB'))
    ).toBe(true);
    expect(detectRamBytes).toHaveBeenCalledWith({ allowEmulator: true });

    const text = combinedText(component!);
    expect(text).toContain('Device RAM: 6.0 GB');
    expect(text).not.toContain('Device RAM: 0.0 GB');
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
      });
      mounted = component;

      expect(
        await flushUntil(() =>
          (detectRamBytes as jest.Mock).mock.calls.some(
            (call) => call[0]?.allowEmulator === false
          )
        )
      ).toBe(true);
      expect(detectRamBytes).toHaveBeenCalledWith({ allowEmulator: false });
    } finally {
      (global as { __DEV__?: boolean }).__DEV__ = originalDev;
      (Platform as { OS?: string }).OS = originalOs;
    }
  });

  it('hides the recommendation card and explains unknown RAM instead of simulating 6 GB', async () => {
    const { detectRamBytes } = require('../utils/ramDetection');
    // Production native build: allowEmulator is false, so the detection mock
    // returns 0 (totalMemory unreadable) — RAM is genuinely unknown.
    const { Platform } = require('react-native');
    const originalDev = (global as { __DEV__?: boolean }).__DEV__;
    const originalOs = (Platform as { OS?: string }).OS;
    (global as { __DEV__?: boolean }).__DEV__ = false;
    (Platform as { OS?: string }).OS = 'android';

    try {
      let component: renderer.ReactTestRenderer | undefined;
      await act(async () => {
        component = renderer.create(<LocalAiScreen />);
      });
      mounted = component;

      // Wait for the 0-byte resolution to render the honest unavailable
      // readout; the store write + re-render is async.
      expect(
        await flushUntil(() =>
          combinedText(component!).includes("Device RAM: unavailable — couldn't read total memory")
        )
      ).toBe(true);
      expect(detectRamBytes).toHaveBeenCalledWith({ allowEmulator: false });

      const allText = () => combinedText(component!);

      // RAM readout stays honest: no simulated value, and it says so.
      expect(allText()).toContain("Device RAM: unavailable — couldn't read total memory");
      expect(allText()).not.toContain('Device RAM: 6.0 GB');
      // No recommendation is fabricated from a simulated 6 GB value.
      expect(allText()).not.toContain('Recommended configuration');
      expect(allText()).not.toContain('System detected');
      // The user is told the reading is unavailable rather than shown silence.
      expect(allText()).toMatch(/couldn't read your device's total memory/i);
      // Model rows are labeled Unknown instead of recommended/borderline.
      expect(allText()).toContain('Unknown');
    } finally {
      (global as { __DEV__?: boolean }).__DEV__ = originalDev;
      (Platform as { OS?: string }).OS = originalOs;
    }
  });
});

describe('LocalAiScreen LiteRT Crash Badge', () => {
  // Same leak guard as the RAM describe: every mounted renderer unmounts
  // in afterEach so a leftover instance cannot re-run its crash-flag /
  // RAM effects (and re-render) during the next test's store writes.
  let mounted: renderer.ReactTestRenderer | undefined;

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
    if (mounted) {
      act(() => {
        mounted!.unmount();
      });
      mounted = undefined;
    }
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
    });
    mounted = component;

    // getGpuCrashFlagDetails() resolves async into local state; poll for
    // the badge instead of a fixed sleep.
    expect(
      await flushUntil(() =>
        component!.root.findAllByProps({ accessibilityRole: 'alert' }).length > 0
      )
    ).toBe(true);

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
      await clearButton.props.onPress();
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
    });
    mounted = component;

    // Let the crash-flag effect resolve (into state, outside act would
    // warn) then assert the badge stayed absent.
    await flushUntil(() => useConfigStore.getState().detectedRamBytes === 6 * 1024 * 1024 * 1024);
    // Negative case: no badge to poll for — drain pending microtasks
    // (crash-flag storage read) so the resolved state has rendered.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const root = component!.root;
    const alertBoxes = root.findAllByProps({ accessibilityRole: 'alert' });
    expect(alertBoxes.length).toBe(0);
  });
});

describe('LocalAiScreen RAM Auto-Config Integration (#612, #615)', () => {
  let mounted: renderer.ReactTestRenderer | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    act(() => {
      useConfigStore.getState().clearConfig();
      useConfigStore.getState().setDetectedRamBytes(8 * 1024 * 1024 * 1024);
    });
  });

  afterEach(() => {
    if (mounted) {
      act(() => {
        mounted!.unmount();
      });
      mounted = undefined;
    }
    jest.restoreAllMocks();
  });

  it('Customize keeps modelOverrides empty and pre-populates draft inputs without marking Applied', async () => {
    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
    });
    mounted = component;

    expect(
      await flushUntil(() =>
        component!.root.findAllByProps({ accessibilityLabel: 'Customize configuration' }).length > 0
      )
    ).toBe(true);

    const customizeBtn = component!.root.findByProps({ accessibilityLabel: 'Customize configuration' });
    act(() => {
      customizeBtn.props.onPress();
    });

    expect(useConfigStore.getState().modelOverrides).toEqual({});
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(false);
    const ctxInput = component!.root.findByProps({ accessibilityLabel: 'Context Size (Tokens)' });
    expect(ctxInput.props.value).toBe('4096');
  });

  it('Accept Recommended applies tier configuration and renders Applied badge', async () => {
    const { Alert } = require('react-native');
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
    });
    mounted = component;

    expect(
      await flushUntil(() =>
        component!.root.findAllByProps({ label: 'Accept Recommended' }).length > 0
      )
    ).toBe(true);

    const acceptBtn = component!.root.findByProps({ label: 'Accept Recommended' });
    act(() => {
      acceptBtn.props.onPress();
    });

    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('Qwen2.5 1.5B (GGUF)');
    expect(state.localContextSize).toBe(4096);
    expect(state.localMaxTokens).toBe(1024);
    expect(state.localConfigAutoApplied).toBe(true);
    expect(
      component!.root.findAllByProps({ accessibilityLabel: 'Recommended configuration applied' }).length
    ).toBeGreaterThan(0);
  });

  it('shows Unknown Device RAM caution instead of fabricating 6 GB tier when RAM is 0', async () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    act(() => {
      useConfigStore.getState().setDetectedRamBytes(0);
    });

    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
    });
    mounted = component;

    expect(
      await flushUntil(() =>
        component!.root.findAllByProps({ accessibilityLabel: 'Device Tier: RAM Unknown' }).length > 0
      )
    ).toBe(true);

    const modelRow = component!.root.findByProps({
      accessibilityLabel: 'Qwen2.5 0.5B Unknown, Not downloaded',
    });
    act(() => {
      modelRow.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Unknown Device RAM',
      expect.stringContaining("couldn't verify your device's total memory"),
      expect.any(Array)
    );
  });

  it('Customize switches to recommended baseline with modelOverrides={}, keeps inputs synced without edit, and persists edits via onBlur', async () => {
    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
    });
    mounted = component;

    expect(
      await flushUntil(() =>
        component!.root.findAllByProps({ accessibilityLabel: 'Customize configuration' }).length > 0
      )
    ).toBe(true);

    // 1. Customize sets recommended baseline (4096 / 1024) in store & drafts without creating modelOverrides or marking Applied
    act(() => {
      component!.root.findByProps({ accessibilityLabel: 'Customize configuration' }).props.onPress();
    });
    const ctxInput = () => component!.root.findByProps({ accessibilityLabel: 'Context Size (Tokens)' });
    const maxInput = () => component!.root.findByProps({ accessibilityLabel: 'Max Output Tokens' });
    expect(useConfigStore.getState().localModelName).toBe('Qwen2.5 1.5B (GGUF)');
    expect(useConfigStore.getState().localContextSize).toBe(4096);
    expect(useConfigStore.getState().localMaxTokens).toBe(1024);
    expect(useConfigStore.getState().modelOverrides).toEqual({});
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(false);
    expect(ctxInput().props.value).toBe('4096');
    expect(maxInput().props.value).toBe('1024');

    // Dismissing keyboard without editing keeps store and UI synced at 4096 / 1024
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onBlur();
    });
    expect(useConfigStore.getState().modelOverrides).toEqual({});
    expect(ctxInput().props.value).toBe('4096');
    expect(maxInput().props.value).toBe('1024');

    // 2. Editing Context Size and blurring (RNW onBlur) commits override and preserves 1024 Max Output Tokens (no snap-back to 512)
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onChangeText('3072');
    });
    act(() => {
      ctxInput().props.onBlur();
    });

    const activeModel = useConfigStore.getState().localModelName;
    expect(useConfigStore.getState().modelOverrides[activeModel]).toEqual({ contextSize: 3072 });
    expect(useConfigStore.getState().localContextSize).toBe(3072);
    expect(useConfigStore.getState().localMaxTokens).toBe(1024);
    expect(maxInput().props.value).toBe('1024');

    // 3. Re-selecting the already-active model resets an uncommitted dirty draft back to store value
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onChangeText('9999');
    });
    const qwenRow = component!.root.findByProps({
      accessibilityLabel: 'Qwen2.5 1.5B (GGUF) Recommended, Not downloaded',
    });
    act(() => {
      qwenRow.props.onPress();
    });
    expect(ctxInput().props.value).toBe('3072');
    act(() => {
      ctxInput().props.onBlur();
    });
    expect(useConfigStore.getState().localContextSize).toBe(3072);

    // 4. Switching to another model while draft is dirty must not write the dirty draft onto the newly selected model on a late blur
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onChangeText('9999');
    });
    const smolRow = component!.root.findByProps({
      accessibilityLabel: 'SmolLM 135M Recommended, Not downloaded',
    });
    act(() => {
      smolRow.props.onPress();
    });
    expect(useConfigStore.getState().localModelName).toBe('SmolLM 135M');
    act(() => {
      ctxInput().props.onBlur();
    });
    expect(useConfigStore.getState().modelOverrides['SmolLM 135M']).toBeUndefined();
    expect(useConfigStore.getState().localContextSize).toBe(4096);

    // 5. Reset Overrides clears dirty draft back to store value even if localContextSize did not change numerically
    act(() => {
      useConfigStore.getState().setModelOverride('SmolLM 135M', { gpuBackend: 'cpu' });
    });
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onChangeText('8192');
    });
    const resetBtn = component!.root.findByProps({ accessibilityLabel: 'Reset overrides for SmolLM 135M' });
    act(() => {
      resetBtn.props.onPress();
    });
    expect(useConfigStore.getState().modelOverrides['SmolLM 135M']).toBeUndefined();
    expect(ctxInput().props.value).toBe('4096');
  });

  it('preserves Applied state on active-model reselection and clamps out-of-range execution parameters', async () => {
    const { Alert } = require('react-native');
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    let component: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      component = renderer.create(<LocalAiScreen />);
    });
    mounted = component;

    expect(
      await flushUntil(() =>
        component!.root.findAllByProps({ label: 'Accept Recommended' }).length > 0
      )
    ).toBe(true);

    act(() => {
      component!.root.findByProps({ label: 'Accept Recommended' }).props.onPress();
    });
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(true);

    // Re-selecting active model keeps Applied badge active
    const activeRow = component!.root.findByProps({
      accessibilityLabel: 'Qwen2.5 1.5B (GGUF) Recommended, Not downloaded',
    });
    act(() => {
      activeRow.props.onPress();
    });
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(true);
    expect(
      component!.root.findAllByProps({ accessibilityLabel: 'Recommended configuration applied' }).length
    ).toBeGreaterThan(0);

    const ctxInput = () => component!.root.findByProps({ accessibilityLabel: 'Context Size (Tokens)' });
    const maxInput = () => component!.root.findByProps({ accessibilityLabel: 'Max Output Tokens' });

    // Clamp contextSize upper bound (99999 -> 32768)
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onChangeText('99999');
    });
    act(() => {
      ctxInput().props.onBlur();
    });
    expect(useConfigStore.getState().localContextSize).toBe(32768);
    expect(ctxInput().props.value).toBe('32768');

    // Clamp maxTokens lower bound (1 -> 64) and upper bound (> contextSize)
    act(() => {
      maxInput().props.onFocus();
      maxInput().props.onChangeText('1');
    });
    act(() => {
      maxInput().props.onBlur();
    });
    expect(useConfigStore.getState().localMaxTokens).toBe(64);
    expect(maxInput().props.value).toBe('64');

    // Clamp contextSize lower bound (10 -> 128) and sibling down-clamp when maxTokens > contextSize
    act(() => {
      maxInput().props.onFocus();
      maxInput().props.onChangeText('2048');
    });
    act(() => {
      maxInput().props.onBlur();
    });
    act(() => {
      ctxInput().props.onFocus();
      ctxInput().props.onChangeText('10');
    });
    act(() => {
      ctxInput().props.onBlur();
    });
    expect(useConfigStore.getState().localContextSize).toBe(128);
    expect(useConfigStore.getState().localMaxTokens).toBe(128);
    expect(ctxInput().props.value).toBe('128');
    expect(maxInput().props.value).toBe('128');
  });
});
