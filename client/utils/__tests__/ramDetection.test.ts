import {
  calculateEstimatedPeakRam,
  getDynamicModelStatusForRam,
  getModelStatusForRam,
  FORMAT_RAM_MULTIPLIERS,
  classifyGpuVendor,
  GPU_BACKEND_TABLE,
  TENSOR_GUARDED_MODELS,
  isTensorGuarded,
  getGpuBackendPreference,
  detectGpuVendor,
  resetGpuVendorCache,
  getVramCapBytes,
  MIN_VRAM_CAP_BYTES,
  MAX_VRAM_CAP_BYTES,
  VRAM_CAP_RATIO,
  shouldForceCpu,
  getOptimalSettingsForRam,
  getSafeInferencePlan,
} from '../ramDetection';
import { Platform } from 'react-native';

const mockHolder: { mod: any } = { mod: null };

jest.mock('../../modules/stable-diffusion', () => ({
  __esModule: true,
  get default() {
    return mockHolder.mod;
  },
}));

describe('ramDetection dynamic calculation & gating', () => {
  const ONE_GB = 1024 * 1024 * 1024;

  it('calculates estimated peak RAM with format multipliers and KV cache', () => {
    const modelSize = 100 * 1024 * 1024; // 100 MB
    // .cact multiplier is 1.2
    const peakCact = calculateEstimatedPeakRam(modelSize, 'cact', 256);
    expect(peakCact).toBeGreaterThan(modelSize * 1.2);

    // .gguf multiplier is 1.35
    const peakGguf = calculateEstimatedPeakRam(modelSize, 'gguf', 256);
    expect(peakGguf).toBeGreaterThan(modelSize * 1.35);

    // .task multiplier is 1.6
    const peakTask = calculateEstimatedPeakRam(modelSize, 'task', 256);
    expect(peakTask).toBeGreaterThan(modelSize * 1.6);
  });

  it('categorizes models against RAM tiers (<50% recommended, 50-75% borderline, >75% unsupported)', () => {
    const ramBytes = 4 * ONE_GB; // 4 GB RAM

    // Peak ~ 1.2 GB (< 50% of 4GB) -> recommended
    const smallModelSize = 800 * 1024 * 1024; // ~800MB * 1.2 = ~960MB
    expect(getDynamicModelStatusForRam(smallModelSize, 'cact', ramBytes)).toBe('recommended');

    // Peak ~ 2.4 GB (60% of 4GB) -> borderline
    const midModelSize = 1800 * 1024 * 1024; // ~1.8GB * 1.35 = ~2.43GB
    expect(getDynamicModelStatusForRam(midModelSize, 'gguf', ramBytes)).toBe('borderline');

    // Peak ~ 3.3 GB (>75% of 4GB) -> unsupported
    const largeModelSize = 2500 * 1024 * 1024; // ~2.5GB * 1.6 = ~4.0GB
    expect(getDynamicModelStatusForRam(largeModelSize, 'task', ramBytes)).toBe('unsupported');
  });

  it('preserves existing static model status lookups', () => {
    expect(getModelStatusForRam('SmolLM 135M', 4 * ONE_GB)).toBe('recommended');
    expect(getModelStatusForRam('Phi-4 Mini (GGUF)', 4 * ONE_GB)).toBe('unsupported');
  });
});

describe('GPU vendor detection & backend preference (#374)', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    resetGpuVendorCache();
    mockHolder.mod = null;
    (Platform as any).OS = 'android';
  });

  afterAll(() => {
    (Platform as any).OS = originalOS;
    resetGpuVendorCache();
  });

  describe('classifyGpuVendor full mapping', () => {
    it('classifies Qualcomm / Snapdragon hardware as adreno', () => {
      expect(classifyGpuVendor('qcom')).toBe('adreno');
      expect(classifyGpuVendor('Qualcomm')).toBe('adreno');
      expect(classifyGpuVendor('msm8998')).toBe('adreno');
      expect(classifyGpuVendor('sdm845')).toBe('adreno');
      expect(classifyGpuVendor('qcom', 'SM8450')).toBe('adreno');
      expect(classifyGpuVendor('snapdragon 8 gen 2')).toBe('adreno');
      expect(classifyGpuVendor('adreno 730')).toBe('adreno');
    });

    it('classifies Samsung Xclipse / RDNA chipsets as xclipse', () => {
      expect(classifyGpuVendor('xclipse')).toBe('xclipse');
      expect(classifyGpuVendor('Xclipse 920')).toBe('xclipse');
      expect(classifyGpuVendor('rdna2')).toBe('xclipse');
      expect(classifyGpuVendor('exynos 2200')).toBe('xclipse');
      expect(classifyGpuVendor('exynos 2400')).toBe('xclipse');
      expect(classifyGpuVendor('exynos 1480')).toBe('xclipse');
      expect(classifyGpuVendor('samsung', 's5e9925')).toBe('xclipse');
      expect(classifyGpuVendor('samsung', 's5e9945')).toBe('xclipse');
    });

    it('classifies MediaTek, Kirin, and standard Exynos as mali', () => {
      expect(classifyGpuVendor('mt6893')).toBe('mali');
      expect(classifyGpuVendor('mediatek dimensity 9000')).toBe('mali');
      expect(classifyGpuVendor('helio g90')).toBe('mali');
      expect(classifyGpuVendor('mtk6765')).toBe('mali');
      expect(classifyGpuVendor('exynos990')).toBe('mali');
      expect(classifyGpuVendor('samsungexynos9820')).toBe('mali');
      expect(classifyGpuVendor('kirin980')).toBe('mali');
      expect(classifyGpuVendor('hisilicon kirin 9000')).toBe('mali');
      expect(classifyGpuVendor('mali-g78')).toBe('mali');
    });

    it('classifies Google Tensor chipsets as tensor', () => {
      expect(classifyGpuVendor('tensor')).toBe('tensor');
      expect(classifyGpuVendor('google tensor')).toBe('tensor');
      expect(classifyGpuVendor('gs101')).toBe('tensor');
      expect(classifyGpuVendor('gs201')).toBe('tensor');
      expect(classifyGpuVendor('zuma')).toBe('tensor');
      expect(classifyGpuVendor('google', 'gs301')).toBe('tensor');
      expect(classifyGpuVendor('google', 'gs401')).toBe('tensor');
    });

    it('classifies garbage, empty, and undefined as unknown', () => {
      expect(classifyGpuVendor('garbage_gpu_123')).toBe('unknown');
      expect(classifyGpuVendor('unknown_chip', 'unsupported_soc')).toBe('unknown');
      expect(classifyGpuVendor('', '')).toBe('unknown');
      expect(classifyGpuVendor('')).toBe('unknown');
      expect(classifyGpuVendor(undefined, undefined)).toBe('unknown');
      expect(classifyGpuVendor()).toBe('unknown');
    });
  });

  describe('GPU_BACKEND_TABLE correctness & fail-safe', () => {
    it('maps vendors correctly according to PrivateLM specifications', () => {
      expect(GPU_BACKEND_TABLE.adreno).toBe('opencl');
      expect(GPU_BACKEND_TABLE.mali).toBe('vulkan');
      expect(GPU_BACKEND_TABLE.xclipse).toBe('vulkan');
      expect(GPU_BACKEND_TABLE.tensor).toBe('cpu');
      expect(GPU_BACKEND_TABLE.unknown).toBe('cpu');
    });

    it('fails safe to cpu for unknown vendor', () => {
      expect(GPU_BACKEND_TABLE['unknown']).toBe('cpu');
    });
  });

  describe('isTensorGuarded', () => {
    it('returns true for Gemma models with Q4_K_M quantization', () => {
      expect(isTensorGuarded('Gemma 2B Q4_K_M')).toBe(true);
      expect(isTensorGuarded('Gemma 7B Q4_K_M')).toBe(true);
      expect(isTensorGuarded('Gemma-2-2B-it-Q4_K_M')).toBe(true);
      expect(isTensorGuarded('gemma-2-2b-it-q4_k_m.gguf')).toBe(true);
      expect(isTensorGuarded('gemma-q4_k_m')).toBe(true);
    });

    it('returns false for other models and non-Q4_K_M Gemma models', () => {
      expect(isTensorGuarded('Qwen2.5 0.5B')).toBe(false);
      expect(isTensorGuarded('Llama 3.2 1B (GGUF)')).toBe(false);
      expect(isTensorGuarded('DeepSeek-R1 1.5B (GGUF)')).toBe(false);
      expect(isTensorGuarded('Gemma 2B')).toBe(false);
      expect(isTensorGuarded('Gemma 2B Q4_0')).toBe(false);
      expect(isTensorGuarded('Llama 3.2 Q4_K_M')).toBe(false);
      expect(isTensorGuarded('')).toBe(false);
    });

    it('exports TENSOR_GUARDED_MODELS list', () => {
      expect(Array.isArray(TENSOR_GUARDED_MODELS)).toBe(true);
      expect(TENSOR_GUARDED_MODELS.length).toBeGreaterThan(0);
    });
  });

  describe('getGpuBackendPreference', () => {
    it('returns the automatic backend when userOverride is auto or omitted', () => {
      expect(getGpuBackendPreference('adreno')).toBe('opencl');
      expect(getGpuBackendPreference('mali')).toBe('vulkan');
      expect(getGpuBackendPreference('xclipse')).toBe('vulkan');
      expect(getGpuBackendPreference('tensor')).toBe('cpu');
      expect(getGpuBackendPreference('unknown')).toBe('cpu');
      expect(getGpuBackendPreference('adreno', 'auto')).toBe('opencl');
    });

    it('honours explicit user override', () => {
      expect(getGpuBackendPreference('adreno', 'vulkan')).toBe('vulkan');
      expect(getGpuBackendPreference('mali', 'opencl')).toBe('opencl');
      expect(getGpuBackendPreference('adreno', 'cpu')).toBe('cpu');
    });

    it('enforces CPU for Gemma Q4_K_M on Tensor when override is auto', () => {
      expect(getGpuBackendPreference('tensor', 'auto', 'Gemma 2B Q4_K_M')).toBe('cpu');
      expect(getGpuBackendPreference('tensor', undefined, 'gemma-q4_k_m')).toBe('cpu');
    });
  });

  describe('detectGpuVendor non-fatal native calls', () => {
    it('returns unknown when native module is missing', async () => {
      mockHolder.mod = null;
      const vendor = await detectGpuVendor();
      expect(vendor).toBe('unknown');
    });

    it('returns unknown when native function throws synchronously', async () => {
      mockHolder.mod = {
        getGpuInfo: () => {
          throw new Error('JNI symbol not found');
        },
      };
      const vendor = await detectGpuVendor();
      expect(vendor).toBe('unknown');
    });

    it('returns unknown when native function rejects asynchronously', async () => {
      mockHolder.mod = {
        getGpuInfo: () => Promise.reject(new Error('Hardware info failed')),
      };
      const vendor = await detectGpuVendor();
      expect(vendor).toBe('unknown');
    });

    it('returns classified vendor on native call success and caches it', async () => {
      mockHolder.mod = {
        getGpuInfo: jest.fn().mockResolvedValue({
          hardware: 'qcom',
          socModel: 'SM8450',
          glEsVersion: '3.2',
        }),
      };

      const vendor1 = await detectGpuVendor();
      expect(vendor1).toBe('adreno');
      expect(mockHolder.mod.getGpuInfo).toHaveBeenCalledTimes(1);

      // Second call should return cached result without calling native again
      const vendor2 = await detectGpuVendor();
      expect(vendor2).toBe('adreno');
      expect(mockHolder.mod.getGpuInfo).toHaveBeenCalledTimes(1);
    });

    it('returns unknown on web platform without calling native', async () => {
      (Platform as any).OS = 'web';
      mockHolder.mod = {
        getGpuInfo: jest.fn(),
      };

      const vendor = await detectGpuVendor();
      expect(vendor).toBe('unknown');
      expect(mockHolder.mod.getGpuInfo).not.toHaveBeenCalled();
    });
  });
});

describe('VRAM cap enforcement & clamping (#375)', () => {
  const ONE_GB = 1024 * 1024 * 1024;

  it('calculates 22% of RAM clamped to [0.75 GB, 1.75 GB] at 2, 4, 6, 8 GB tiers', () => {
    // 2 GB RAM: 22% = 0.44 GB, clamped up to 0.75 GB floor
    expect(getVramCapBytes(2 * ONE_GB)).toBe(MIN_VRAM_CAP_BYTES);
    expect(getVramCapBytes(2 * ONE_GB)).toBe(Math.round(0.75 * ONE_GB));

    // 4 GB RAM: 22% = 0.88 GB, within bounds
    const cap4GB = getVramCapBytes(4 * ONE_GB);
    expect(cap4GB).toBe(Math.round(4 * ONE_GB * VRAM_CAP_RATIO));
    expect(cap4GB).toBeGreaterThan(MIN_VRAM_CAP_BYTES);
    expect(cap4GB).toBeLessThan(MAX_VRAM_CAP_BYTES);

    // 6 GB RAM: 22% = 1.32 GB, within bounds
    const cap6GB = getVramCapBytes(6 * ONE_GB);
    expect(cap6GB).toBe(Math.round(6 * ONE_GB * VRAM_CAP_RATIO));
    expect(cap6GB).toBeGreaterThan(MIN_VRAM_CAP_BYTES);
    expect(cap6GB).toBeLessThan(MAX_VRAM_CAP_BYTES);

    // 8 GB RAM: 22% = 1.76 GB, clamped down to 1.75 GB ceiling
    expect(getVramCapBytes(8 * ONE_GB)).toBe(MAX_VRAM_CAP_BYTES);
    expect(getVramCapBytes(8 * ONE_GB)).toBe(Math.round(1.75 * ONE_GB));
  });

  it('clamps correctly at and either side of the 0.75 GB floor boundary (~3.41 GB)', () => {
    // 3.4 GB: 3.4 * 0.22 = 0.748 GB (< 0.75 GB floor) -> clamped to 0.75 GB
    const ram3_4GB = Math.round(3.4 * ONE_GB);
    expect(getVramCapBytes(ram3_4GB)).toBe(MIN_VRAM_CAP_BYTES);

    // 3.5 GB: 3.5 * 0.22 = 0.77 GB (> 0.75 GB floor) -> 0.77 GB unclamped
    const ram3_5GB = Math.round(3.5 * ONE_GB);
    expect(getVramCapBytes(ram3_5GB)).toBe(Math.round(ram3_5GB * VRAM_CAP_RATIO));
    expect(getVramCapBytes(ram3_5GB)).toBeGreaterThan(MIN_VRAM_CAP_BYTES);
  });

  it('clamps correctly at and either side of the 1.75 GB ceiling boundary (~7.95 GB)', () => {
    // 7.9 GB: 7.9 * 0.22 = 1.738 GB (< 1.75 GB ceiling) -> unclamped
    const ram7_9GB = Math.round(7.9 * ONE_GB);
    expect(getVramCapBytes(ram7_9GB)).toBe(Math.round(ram7_9GB * VRAM_CAP_RATIO));
    expect(getVramCapBytes(ram7_9GB)).toBeLessThan(MAX_VRAM_CAP_BYTES);

    // 8.0 GB: 8.0 * 0.22 = 1.76 GB (> 1.75 GB ceiling) -> clamped to 1.75 GB
    expect(getVramCapBytes(8 * ONE_GB)).toBe(MAX_VRAM_CAP_BYTES);

    // 12.0 GB: well above ceiling -> clamped to 1.75 GB
    expect(getVramCapBytes(12 * ONE_GB)).toBe(MAX_VRAM_CAP_BYTES);
  });

  it('safely handles non-positive RAM values', () => {
    expect(getVramCapBytes(0)).toBe(MIN_VRAM_CAP_BYTES);
    expect(getVramCapBytes(-1000)).toBe(MIN_VRAM_CAP_BYTES);
  });

  it('safely handles NaN and non-finite RAM values by failing safe to clamp boundaries', () => {
    expect(getVramCapBytes(NaN)).toBe(MIN_VRAM_CAP_BYTES);
    expect(getVramCapBytes(-Infinity)).toBe(MIN_VRAM_CAP_BYTES);
    expect(getVramCapBytes(Infinity)).toBe(MAX_VRAM_CAP_BYTES);
    expect(shouldForceCpu(2 * 1024 * 1024 * 1024, getVramCapBytes(NaN))).toBe(true);
    expect(shouldForceCpu(2 * 1024 * 1024 * 1024, NaN)).toBe(true);
    expect(shouldForceCpu(2 * 1024 * 1024 * 1024, Infinity)).toBe(true);
  });
});

describe('RAM tier alignment ladder (#375)', () => {
  const ONE_GB = 1024 * 1024 * 1024;

  it('lands on exact (contextSize, maxTokens) pairs across 2, 4, 6, 8 GB and >8 GB tiers', () => {
    // <= 4 GB tier
    const settings2GB = getOptimalSettingsForRam(2 * ONE_GB);
    expect(settings2GB).toEqual({
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    });

    const settings4GB = getOptimalSettingsForRam(4 * ONE_GB);
    expect(settings4GB).toEqual({
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    });

    // <= 6 GB tier
    const settings6GB = getOptimalSettingsForRam(6 * ONE_GB);
    expect(settings6GB).toEqual({
      modelName: 'Qwen2.5 0.5B',
      contextSize: 2048,
      maxTokens: 512,
    });

    // <= 8 GB tier
    const settings8GB = getOptimalSettingsForRam(8 * ONE_GB);
    expect(settings8GB).toEqual({
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 4096,
      maxTokens: 1024,
    });

    // > 8 GB tier (e.g. 12 GB, 16 GB)
    const settings12GB = getOptimalSettingsForRam(12 * ONE_GB);
    expect(settings12GB).toEqual({
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 8192,
      maxTokens: 4096,
    });

    const settings16GB = getOptimalSettingsForRam(16 * ONE_GB);
    expect(settings16GB).toEqual({
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 8192,
      maxTokens: 4096,
    });
  });

  it('guarantees monotonicity across a continuous sweep of RAM values', () => {
    let prevCtx = 0;
    let prevMax = 0;

    // Sweep from 1 GB to 16 GB in 0.5 GB steps
    for (let gb = 1; gb <= 16; gb += 0.5) {
      const settings = getOptimalSettingsForRam(Math.round(gb * ONE_GB));
      expect(settings.contextSize).toBeGreaterThanOrEqual(prevCtx);
      expect(settings.maxTokens).toBeGreaterThanOrEqual(prevMax);
      prevCtx = settings.contextSize;
      prevMax = settings.maxTokens;
    }
  });

  it('preserves needle recommendation across all tiers and never returns needle as tier preset', () => {
    for (const ramGB of [2, 4, 6, 8, 12]) {
      const ram = ramGB * ONE_GB;
      expect(getModelStatusForRam('Needle-2 45M', ram)).toBe('recommended');
      expect(getModelStatusForRam('Needle-3 (20-layer)', ram)).toBe('recommended');

      const preset = getOptimalSettingsForRam(ram);
      expect(preset.modelName).not.toContain('Needle');
    }
  });

  it('safely falls back to the lowest tier on NaN and non-positive RAM values', () => {
    expect(getOptimalSettingsForRam(NaN)).toEqual({
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    });
    expect(getOptimalSettingsForRam(0)).toEqual({
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    });
    expect(getOptimalSettingsForRam(-1)).toEqual({
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    });
    expect(getModelStatusForRam('Phi-4 Mini (GGUF)', NaN)).toBe('unsupported');
    expect(getModelStatusForRam('Phi-4 Mini (GGUF)', 0)).toBe('unsupported');
    expect(getModelStatusForRam('SmolLM 135M', NaN)).toBe('recommended');
    expect(getDynamicModelStatusForRam(2 * ONE_GB, 'gguf', NaN)).toBe('unsupported');
    expect(getDynamicModelStatusForRam(2 * ONE_GB, 'gguf', 0)).toBe('unsupported');
  });
});

describe('GPU-guard & force-CPU user override (#375)', () => {
  const ONE_GB = 1024 * 1024 * 1024;

  describe('shouldForceCpu', () => {
    it('returns true when estimated peak RAM exceeds VRAM cap', () => {
      const vramCap = getVramCapBytes(4 * ONE_GB); // ~0.88 GB
      const largeModelSize = 2 * ONE_GB; // 2 GB * 1.35 + 1MB = ~2.7 GB > 0.88 GB
      expect(shouldForceCpu(largeModelSize, vramCap, 'gguf', 2048)).toBe(true);
    });

    it('returns false when estimated peak RAM is within VRAM cap', () => {
      const vramCap = getVramCapBytes(8 * ONE_GB); // 1.75 GB
      const smallModelSize = 50 * 1024 * 1024; // 50 MB * 1.2 + 2MB = ~62 MB << 1.75 GB
      expect(shouldForceCpu(smallModelSize, vramCap, 'cact', 4096)).toBe(false);
    });

    it('handles non-positive values cleanly', () => {
      expect(shouldForceCpu(0, 1000)).toBe(false);
      expect(shouldForceCpu(1000, 0)).toBe(true);
    });
  });

  describe('getGpuBackendPreference with GPU-guard', () => {
    it('forces CPU backend when model exceeds VRAM cap, regardless of vendor', () => {
      const vramCap = getVramCapBytes(4 * ONE_GB); // ~0.88 GB
      const largeModel = 2 * ONE_GB; // Exceeds cap

      expect(
        getGpuBackendPreference('adreno', 'auto', undefined, {
          modelSizeBytes: largeModel,
          vramCapBytes: vramCap,
          format: 'gguf',
        })
      ).toBe('cpu');

      expect(
        getGpuBackendPreference('mali', 'auto', undefined, {
          modelSizeBytes: largeModel,
          vramCapBytes: vramCap,
          format: 'gguf',
        })
      ).toBe('cpu');
    });

    it('honours vendor GPU backend when model is within VRAM cap', () => {
      const vramCap = getVramCapBytes(8 * ONE_GB); // 1.75 GB
      const smallModel = 50 * 1024 * 1024; // 50 MB

      expect(
        getGpuBackendPreference('adreno', 'auto', undefined, {
          modelSizeBytes: smallModel,
          vramCapBytes: vramCap,
          format: 'cact',
        })
      ).toBe('opencl');

      expect(
        getGpuBackendPreference('mali', 'auto', undefined, {
          modelSizeBytes: smallModel,
          vramCapBytes: vramCap,
          format: 'cact',
        })
      ).toBe('vulkan');
    });

    it('proves explicit cpu override beats auto path even when guard would allow GPU', () => {
      const vramCap = getVramCapBytes(8 * ONE_GB); // 1.75 GB
      const smallModel = 50 * 1024 * 1024; // Small model fits in VRAM

      // Under 'auto', adreno would resolve to 'opencl'
      expect(
        getGpuBackendPreference('adreno', 'auto', undefined, {
          modelSizeBytes: smallModel,
          vramCapBytes: vramCap,
        })
      ).toBe('opencl');

      // Explicit 'cpu' override beats auto
      expect(
        getGpuBackendPreference('adreno', 'cpu', undefined, {
          modelSizeBytes: smallModel,
          vramCapBytes: vramCap,
        })
      ).toBe('cpu');
    });

    it('maintains Tensor Gemma guard and unknown fail-safe', () => {
      expect(getGpuBackendPreference('tensor', 'auto', 'Gemma 2B Q4_K_M')).toBe('cpu');
      expect(getGpuBackendPreference('unknown')).toBe('cpu');
    });
  });
});

describe('getSafeInferencePlan composed helper (#375)', () => {
  const ONE_GB = 1024 * 1024 * 1024;

  it('produces safe plan for small model on 8 GB Adreno device', () => {
    const plan = getSafeInferencePlan(
      8 * ONE_GB,
      50 * 1024 * 1024,
      'cact',
      'adreno'
    );

    expect(plan).toEqual({
      contextSize: 4096,
      maxTokens: 1024,
      backend: 'opencl',
      vramCapBytes: MAX_VRAM_CAP_BYTES,
      forcedCpu: false,
      status: 'recommended',
    });
  });

  it('forces CPU and flags unsupported for oversized model on 4 GB device', () => {
    const plan = getSafeInferencePlan(
      4 * ONE_GB,
      2.5 * ONE_GB,
      'task',
      'adreno'
    );

    expect(plan.contextSize).toBe(1024);
    expect(plan.maxTokens).toBe(256);
    expect(plan.backend).toBe('cpu');
    expect(plan.forcedCpu).toBe(true);
    expect(plan.status).toBe('unsupported');
  });

  it('honours explicit CPU override in inference plan', () => {
    const plan = getSafeInferencePlan(
      8 * ONE_GB,
      50 * 1024 * 1024,
      'cact',
      'adreno',
      'cpu'
    );

    expect(plan.backend).toBe('cpu');
    expect(plan.forcedCpu).toBe(false);
  });

  it('applies >8 GB tier context and token counts', () => {
    const plan = getSafeInferencePlan(
      12 * ONE_GB,
      100 * 1024 * 1024,
      'gguf',
      'mali'
    );

    expect(plan.contextSize).toBe(8192);
    expect(plan.maxTokens).toBe(4096);
    expect(plan.backend).toBe('vulkan');
    expect(plan.forcedCpu).toBe(false);
  });

  it('fails safe when ramBytes is NaN in getSafeInferencePlan', () => {
    const plan = getSafeInferencePlan(
      NaN,
      2 * ONE_GB,
      'gguf',
      'adreno'
    );

    expect(plan.contextSize).toBe(1024);
    expect(plan.maxTokens).toBe(256);
    expect(plan.vramCapBytes).toBe(MIN_VRAM_CAP_BYTES);
    expect(plan.forcedCpu).toBe(true);
    expect(plan.backend).toBe('cpu');
    expect(plan.status).toBe('unsupported');
  });
});
