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
