import * as Device from 'expo-device';
import { Platform } from 'react-native';
import StableDiffusionNative from '../modules/stable-diffusion';

export type ModelRecommendationStatus = 'recommended' | 'borderline' | 'unsupported';

export type GpuVendor = 'adreno' | 'mali' | 'xclipse' | 'tensor' | 'unknown';
export type GpuBackend = 'opencl' | 'vulkan' | 'cpu';

export const GPU_BACKEND_TABLE: Record<GpuVendor, GpuBackend> = {
  adreno: 'opencl',
  mali: 'vulkan',
  xclipse: 'vulkan',
  tensor: 'cpu',
  unknown: 'cpu',
};

/**
 * Models that are guarded against GPU execution on Google Tensor hardware.
 *
 * Why: On Google Tensor SoCs (Pixel 6-9), Gemma Q4_K_M triggers known driver/shader
 * issues in mobile Vulkan/OpenCL runtimes when compiling intermediate matrix kernels,
 * causing system freeze or SIGSEGV. This is a stability guard rather than an inherent
 * format limitation, ensuring Tensor devices fail safe to CPU or protected inference.
 */
export const TENSOR_GUARDED_MODELS: readonly string[] = [
  'Gemma 2B Q4_K_M',
  'Gemma 7B Q4_K_M',
  'Gemma-2-2B-it-Q4_K_M',
  'gemma-2-2b-it-Q4_K_M.gguf',
  'gemma-q4_k_m',
];

export function isTensorGuarded(modelName: string): boolean {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return lower.includes('gemma') && lower.includes('q4_k_m');
}

/**
 * Classifies a device's GPU vendor from Android hardware and SoC identifiers.
 *
 * - Adreno: Qualcomm chipsets (qcom, msm, sdm, snapdragon, smXXXX)
 * - Xclipse: Samsung AMD RDNA chipsets (xclipse, rdna, Exynos 2200/2400/1480/2500)
 * - Mali: ARM Mali chipsets (other Exynos, MediaTek/Dimensity/Helio, Kirin)
 * - Tensor: Google Tensor chipsets (gs101, gs201, zuma/gs301, zuma pro/gs401)
 * - unknown: Anything unrecognized falls back safely to unknown
 */
export function classifyGpuVendor(hardware?: string, socModel?: string): GpuVendor {
  if (!hardware && !socModel) return 'unknown';

  const hw = (typeof hardware === 'string' ? hardware : '').toLowerCase().trim();
  const soc = (typeof socModel === 'string' ? socModel : '').toLowerCase().trim();
  const text = `${hw} ${soc}`.trim();

  if (!text) return 'unknown';

  // 1. Google Tensor (Pixel 6+: GS101, GS201, Zuma/GS301, Zuma Pro/GS401)
  if (
    text.includes('tensor') ||
    text.includes('zuma') ||
    /\bgs[1-4]\w*/.test(text) ||
    /gs[1-4]01/.test(text)
  ) {
    return 'tensor';
  }

  // 2. Qualcomm / Adreno
  if (
    text.includes('adreno') ||
    text.includes('qcom') ||
    text.includes('qualcomm') ||
    text.includes('snapdragon') ||
    /\b(msm|sdm)\w*/.test(text) ||
    /\bsm\d{4}\w*/.test(text)
  ) {
    return 'adreno';
  }

  // 3. Samsung Xclipse (AMD RDNA on Exynos 2200 / 2400 / 1480 / 2500)
  if (
    text.includes('xclipse') ||
    text.includes('rdna') ||
    /(s5e9925|s5e9945|s5e8845)/.test(text) ||
    (text.includes('exynos') && /(2200|2400|1480|2500|920|940|530)/.test(text))
  ) {
    return 'xclipse';
  }

  // 4. ARM Mali (Standard Exynos, MediaTek, HiSilicon Kirin)
  if (
    text.includes('mali') ||
    text.includes('exynos') ||
    text.includes('kirin') ||
    text.includes('hisilicon') ||
    text.includes('mediatek') ||
    text.includes('dimensity') ||
    text.includes('helio') ||
    /\bmt\d+\w*/.test(text) ||
    /\bmtk\w*/.test(text)
  ) {
    return 'mali';
  }

  return 'unknown';
}

/**
 * Resolves effective GPU backend preference, honouring user override if specified.
 */
export function getGpuBackendPreference(
  vendor: GpuVendor,
  userOverride?: 'auto' | 'opencl' | 'vulkan' | 'cpu',
  modelName?: string
): GpuBackend {
  if (userOverride && userOverride !== 'auto') {
    return userOverride;
  }
  if (vendor === 'tensor' && modelName && isTensorGuarded(modelName)) {
    return 'cpu';
  }
  return GPU_BACKEND_TABLE[vendor] ?? 'cpu';
}

let cachedGpuVendor: GpuVendor | null = null;

export function resetGpuVendorCache(): void {
  cachedGpuVendor = null;
}

/**
 * Detects GPU vendor natively via non-fatal call to StableDiffusionModule.getGpuInfo.
 * If the module is missing, throws, or rejects, safely returns 'unknown' and never throws.
 */
export async function detectGpuVendor(): Promise<GpuVendor> {
  if (cachedGpuVendor !== null) {
    return cachedGpuVendor;
  }

  if (Platform.OS === 'web') {
    cachedGpuVendor = 'unknown';
    return 'unknown';
  }

  try {
    const mod = StableDiffusionNative;
    if (!mod || typeof mod.getGpuInfo !== 'function') {
      cachedGpuVendor = 'unknown';
      return 'unknown';
    }

    const info = await mod.getGpuInfo();
    if (!info || typeof info !== 'object') {
      cachedGpuVendor = 'unknown';
      return 'unknown';
    }

    const hardware =
      typeof info.hardware === 'string'
        ? info.hardware
        : typeof info.vendor === 'string'
        ? info.vendor
        : '';
    const socModel = typeof info.socModel === 'string' ? info.socModel : undefined;

    cachedGpuVendor = classifyGpuVendor(hardware, socModel);
    return cachedGpuVendor;
  } catch (err) {
    console.warn('[ramDetection] Failed to detect GPU vendor natively:', err);
    cachedGpuVendor = 'unknown';
    return 'unknown';
  }
}

export const FORMAT_RAM_MULTIPLIERS: Record<string, number> = {
  cact: 1.2,
  gguf: 1.35,
  task: 1.6,
};

export const KV_CACHE_BYTES_PER_TOKEN = 512;

export function calculateEstimatedPeakRam(
  modelSizeBytes: number,
  format: string,
  contextSize: number = 2048
): number {
  const normFormat = format.toLowerCase().replace(/^\./, '');
  const multiplier = FORMAT_RAM_MULTIPLIERS[normFormat] ?? 1.35;
  const kvCache = contextSize * KV_CACHE_BYTES_PER_TOKEN;
  return Math.round(modelSizeBytes * multiplier + kvCache);
}

/**
 * Size-driven tier status: peak RAM (size * FORMAT_RAM_MULTIPLIERS[format] +
 * contextSize * KV_CACHE_BYTES_PER_TOKEN) as a fraction of device RAM.
 * <50% recommended, 50-75% borderline, >75% unsupported.
 *
 * The shipping `.cact` sizes (needle2 13,737,807 B, needle3 35,335,380 B,
 * research #292) stay 'recommended' at every realistic tier — including with
 * needle3's 8192-token context (#296). No needle-specific branch is needed.
 */
export function getDynamicModelStatusForRam(
  modelSizeBytes: number,
  format: string,
  ramBytes: number,
  contextSize: number = 2048
): ModelRecommendationStatus {
  if (ramBytes <= 0) return 'borderline';
  const estimatedPeak = calculateEstimatedPeakRam(modelSizeBytes, format, contextSize);
  const ratio = estimatedPeak / ramBytes;
  if (ratio < 0.5) return 'recommended';
  if (ratio <= 0.75) return 'borderline';
  return 'unsupported';
}

export async function detectRamBytes(): Promise<number> {
  if (Platform.OS === 'web') {
    return 6 * 1024 * 1024 * 1024; // 6 GB default for web/simulation
  }
  
  try {
    const memory = Device.totalMemory;
    if (memory && memory > 0) {
      return memory;
    }
  } catch (err) {
    console.warn('[ramDetection] Failed to read totalMemory from Device api:', err);
  }
  
  return 6 * 1024 * 1024 * 1024; // fallback 6 GB if not available
}

/**
 * Maps a model name to its RAM recommendation tier.
 *
 * Model names must match `LOCAL_MODELS` in `utils/localLlm.ts` exactly.
 *
 * | Model                    | Size     | <4.5 GB   | 4.5-7.5 GB | >=7.5 GB  |
 * |--------------------------|----------|------------|------------|-----------|
 * | Needle-2 45M             | ~0.014 GB| recommended| recommended| recommended|
 * | Needle-3 (20-layer)      | ~0.035 GB| recommended| recommended| recommended|
 * | SmolLM 135M              | ~0.16 GB | recommended| supported*| recommended|
 * | Qwen2.5 0.5B             | ~0.52 GB | borderline | recommended| recommended|
 * | Llama 3.2 1B (GGUF)      | ~0.81 GB | unsupported| recommended| recommended|
 * | TinyLlama 1.1B           | ~1.1 GB  | unsupported| borderline | recommended|
 * | Qwen2.5 1.5B (GGUF)      | ~1.06 GB | unsupported| borderline | recommended|
 * | DeepSeek-R1 1.5B (GGUF)  | ~1.06 GB | unsupported| borderline | recommended|
 * | Qwen2.5 1.5B             | ~1.5 GB  | unsupported| borderline | recommended|
 * | DeepSeek-R1 1.5B         | ~1.9 GB  | unsupported| borderline | recommended|
 * | Phi-4 Mini (GGUF)        | ~2.5 GB  | unsupported| unsupported| recommended|
 *
 * *Mid-tier also covers task-variant names (without GGUF suffix) for 1.5B models.
 * Keep strings in sync with LOCAL_MODELS to prevent drift.
 *
 * TODO(follow-up ladder map, after #289): only the shipping `.cact` files are
 * tiered here — `needle2.cact` (13,737,807 B) and the full 20-layer
 * `needle3.cact` (35,335,380 B), per HF trees verified in research #292.
 * The 4/8/12-layer Needle-3 ladder slices are deferred (#290) and their sizes
 * are UNVERIFIED — the upstream README's "8-29 MB" range does not match the
 * shipped 35.3 MB file (#292) and must not be encoded here. Add ladder rows to
 * this table (and lock them with tests) once real slices are published.
 */
export function getModelStatusForRam(modelName: string, ramBytes: number): ModelRecommendationStatus {
  const ramGB = ramBytes / (1024 * 1024 * 1024);

  if (ramGB < 4.5) {
    if (
      modelName === 'Needle-2 45M' ||
      modelName === 'Needle-3 (20-layer)' ||
      modelName === 'SmolLM 135M'
    )
      return 'recommended';
    if (modelName === 'Qwen2.5 0.5B') return 'borderline';
    return 'unsupported';
  } else if (ramGB < 7.5) {
    if (
      modelName === 'Needle-2 45M' ||
      modelName === 'Needle-3 (20-layer)' ||
      modelName === 'Qwen2.5 0.5B' ||
      modelName === 'Llama 3.2 1B (GGUF)'
    )
      return 'recommended';
    if (
      modelName === 'TinyLlama 1.1B' ||
      modelName === 'Qwen2.5 1.5B (GGUF)' ||
      modelName === 'DeepSeek-R1 1.5B (GGUF)' ||
      modelName === 'Qwen2.5 1.5B' ||
      modelName === 'DeepSeek-R1 1.5B'
    ) {
      return 'borderline';
    }
    return 'unsupported';
  } else {
    // High tier (>= 7.5 GB) - all models are recommended, nothing is unsupported
    return 'recommended';
  }
}

/**
 * Returns optimal inference settings for the device's RAM tier.
 * - Low  (<4.5 GB):  SmolLM 135M,      ctx 1024, max 256
 * - Mid  (4.5-7.5):  Qwen2.5 0.5B,      ctx 2048, max 512
 * - High (>=7.5 GB): Qwen2.5 1.5B (GGUF), ctx 4096, max 1024
 * High-tier prefers Qwen2.5 1.5B (GGUF) (~1.06 GB) over TinyLlama 1.1B for quality at similar footprint.
 *
 * Needle entries (Needle-2 45M / Needle-3 (20-layer)) are never returned as a
 * tier preset: they are 'recommended' on every tier via getModelStatusForRam
 * (so the picker never hides them), but this function keeps returning the chat
 * presets above. Needle session RAM is TBC (#292) — do not invent a number to
 * promote a needle row here.
 */
export function getOptimalSettingsForRam(ramBytes: number): {
  modelName: string;
  contextSize: number;
  maxTokens: number;
} {
  const ramGB = ramBytes / (1024 * 1024 * 1024);

  if (ramGB < 4.5) {
    return {
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    };
  } else if (ramGB < 7.5) {
    return {
      modelName: 'Qwen2.5 0.5B',
      contextSize: 2048,
      maxTokens: 512,
    };
  } else {
    return {
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 4096,
      maxTokens: 1024,
    };
  }
}
