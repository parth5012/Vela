import { useConfigStore, selectIsRecommendationApplied } from '../store/useConfigStore';

describe('useConfigStore per-model overrides (#612, #615)', () => {
  beforeEach(() => {
    useConfigStore.setState({
      localModelName: 'SmolLM 135M',
      localContextSize: 1024,
      localMaxTokens: 256,
      gpuBackendPreference: 'auto',
      localConfigAutoApplied: false,
      detectedRamBytes: 8 * 1024 * 1024 * 1024,
      modelOverrides: {},
    });
  });

  it('sets and persists per-model overrides', () => {
    const { setModelOverride } = useConfigStore.getState();

    // Set override for a non-active model
    setModelOverride('Qwen2.5 1.5B (GGUF)', {
      contextSize: 4096,
      maxTokens: 1024,
      gpuBackend: 'vulkan',
    });

    const state = useConfigStore.getState();
    expect(state.modelOverrides['Qwen2.5 1.5B (GGUF)']).toEqual({
      contextSize: 4096,
      maxTokens: 1024,
      gpuBackend: 'vulkan',
    });

    // Active model params should remain untouched
    expect(state.localModelName).toBe('SmolLM 135M');
    expect(state.localContextSize).toBe(1024);
  });

  it('immediately updates active parameters when overriding the currently active model', () => {
    const { setModelOverride } = useConfigStore.getState();

    setModelOverride('SmolLM 135M', {
      contextSize: 2048,
      maxTokens: 512,
      gpuBackend: 'cpu',
    });

    const state = useConfigStore.getState();
    expect(state.modelOverrides['SmolLM 135M']).toEqual({
      contextSize: 2048,
      maxTokens: 512,
      gpuBackend: 'cpu',
    });
    expect(state.localContextSize).toBe(2048);
    expect(state.localMaxTokens).toBe(512);
    expect(state.gpuBackendPreference).toBe('cpu');
  });

  it('clears per-model overrides cleanly', () => {
    const { setModelOverride, clearModelOverride } = useConfigStore.getState();

    setModelOverride('Phi-4 Mini (GGUF)', { contextSize: 8192 });
    expect(useConfigStore.getState().modelOverrides['Phi-4 Mini (GGUF)']).toBeDefined();

    clearModelOverride('Phi-4 Mini (GGUF)');
    expect(useConfigStore.getState().modelOverrides['Phi-4 Mini (GGUF)']).toBeUndefined();
  });

  it('applies overridden settings when switching to a model with overrides', () => {
    const { setModelOverride, applyModelSettings } = useConfigStore.getState();

    setModelOverride('Qwen2.5 0.5B', {
      contextSize: 3000,
      maxTokens: 750,
      gpuBackend: 'opencl',
    });

    applyModelSettings('Qwen2.5 0.5B');

    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('Qwen2.5 0.5B');
    expect(state.localContextSize).toBe(3000);
    expect(state.localMaxTokens).toBe(750);
    expect(state.gpuBackendPreference).toBe('opencl');
  });

  it('falls back to hardware tier defaults when switching to a model without overrides', () => {
    const { applyModelSettings } = useConfigStore.getState();

    // 8GB device tier default for optimal settings is Qwen2.5 1.5B (GGUF) ctx 4096, max 1024
    applyModelSettings('DeepSeek-R1 1.5B (GGUF)');

    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('DeepSeek-R1 1.5B (GGUF)');
    expect(state.localContextSize).toBe(4096);
    expect(state.localMaxTokens).toBe(1024);
    expect(state.gpuBackendPreference).toBe('auto');
  });

  it('uses tier defaults for unset fields in a partial model override', () => {
    const { setModelOverride, applyModelSettings } = useConfigStore.getState();

    // Model A sets custom maxTokens and gpuBackend
    applyModelSettings('SmolLM 135M');
    setModelOverride('SmolLM 135M', { contextSize: 512, maxTokens: 128, gpuBackend: 'cpu' });

    // Model B only overrides contextSize; maxTokens & gpuBackend should reset to tier/auto
    setModelOverride('Qwen2.5 1.5B (GGUF)', { contextSize: 2048 });
    applyModelSettings('Qwen2.5 1.5B (GGUF)');

    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('Qwen2.5 1.5B (GGUF)');
    expect(state.localContextSize).toBe(2048);
    expect(state.localMaxTokens).toBe(1024);
    expect(state.gpuBackendPreference).toBe('auto');
  });

  it('acceptRecommendedConfig applies displayed tier settings even when an override exists and clears stale override', () => {
    const { setModelOverride, acceptRecommendedConfig } = useConfigStore.getState();

    // Pre-existing override on the 8 GB recommended model
    setModelOverride('Qwen2.5 1.5B (GGUF)', {
      contextSize: 2048,
      maxTokens: 512,
      gpuBackend: 'cpu',
    });

    acceptRecommendedConfig();

    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('Qwen2.5 1.5B (GGUF)');
    expect(state.localContextSize).toBe(4096);
    expect(state.localMaxTokens).toBe(1024);
    expect(state.gpuBackendPreference).toBe('auto');
    expect(state.localConfigAutoApplied).toBe(true);
    expect(state.modelOverrides['Qwen2.5 1.5B (GGUF)']).toBeUndefined();
  });

  it('preserves manual parameters when RAM is unknown (0 or null) instead of fabricating a 6 GB tier', () => {
    useConfigStore.setState({
      detectedRamBytes: 0,
      localModelName: 'SmolLM 135M',
      localContextSize: 1536,
      localMaxTokens: 384,
    });

    useConfigStore.getState().applyModelSettings('DeepSeek-R1 1.5B (GGUF)');

    const state = useConfigStore.getState();
    expect(state.localModelName).toBe('DeepSeek-R1 1.5B (GGUF)');
    expect(state.localContextSize).toBe(1536);
    expect(state.localMaxTokens).toBe(384);
  });

  it('clears localConfigAutoApplied when switching models or editing parameters', () => {
    const { acceptRecommendedConfig, setModelOverride, applyModelSettings } = useConfigStore.getState();

    acceptRecommendedConfig();
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(true);

    setModelOverride('Qwen2.5 1.5B (GGUF)', { contextSize: 2048 });
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(false);

    acceptRecommendedConfig();
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(true);

    applyModelSettings('SmolLM 135M');
    expect(useConfigStore.getState().localConfigAutoApplied).toBe(false);
  });

  it('acceptRecommendedConfig is a no-op when detectedRamBytes is unknown (0, null, NaN, Infinity)', () => {
    for (const badRam of [0, null, NaN, Infinity]) {
      useConfigStore.setState({
        detectedRamBytes: badRam,
        localModelName: 'SmolLM 135M',
        localContextSize: 1024,
        localMaxTokens: 256,
        localConfigAutoApplied: false,
      });
      useConfigStore.getState().acceptRecommendedConfig();
      const state = useConfigStore.getState();
      expect(state.localModelName).toBe('SmolLM 135M');
      expect(state.localContextSize).toBe(1024);
      expect(state.localConfigAutoApplied).toBe(false);
    }
  });

  it('prunes redundant auto gpuBackend override and keeps selectIsRecommendationApplied in sync', () => {
    const { acceptRecommendedConfig, setModelOverride } = useConfigStore.getState();

    acceptRecommendedConfig();
    expect(selectIsRecommendationApplied(useConfigStore.getState())).toBe(true);

    setModelOverride('Qwen2.5 1.5B (GGUF)', { gpuBackend: 'cpu' });
    expect(useConfigStore.getState().modelOverrides['Qwen2.5 1.5B (GGUF)']).toEqual({ gpuBackend: 'cpu' });
    expect(selectIsRecommendationApplied(useConfigStore.getState())).toBe(false);

    setModelOverride('Qwen2.5 1.5B (GGUF)', { gpuBackend: 'auto' });
    expect(useConfigStore.getState().modelOverrides['Qwen2.5 1.5B (GGUF)']).toBeUndefined();
    expect(useConfigStore.getState().gpuBackendPreference).toBe('auto');
  });
});
