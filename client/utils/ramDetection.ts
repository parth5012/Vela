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

export const MIN_VRAM_CAP_BYTES = Math.round(0.75 * 1024 * 1024 * 1024);
export const MAX_VRAM_CAP_BYTES = Math.round(1.75 * 1024 * 1024 * 1024);
export const VRAM_CAP_RATIO = 0.22;

/**
 * Calculates device VRAM cap for GPU inference:
 * 22% of total device RAM, clamped to [0.75 GB, 1.75 GB] inclusive.
 */
export function getVramCapBytes(ramBytes: number): number {
  if (!Number.isFinite(ramBytes)) {
    if (ramBytes === Infinity) return MAX_VRAM_CAP_BYTES;
    return MIN_VRAM_CAP_BYTES;
  }
  if (ramBytes <= 0) return MIN_VRAM_CAP_BYTES;
  const rawCap = ramBytes * VRAM_CAP_RATIO;
  return Math.round(Math.min(Math.max(rawCap, MIN_VRAM_CAP_BYTES), MAX_VRAM_CAP_BYTES));
}

/**
 * Guard predicate determining whether an inference workload must be forced to CPU.
 * A model whose estimated peak VRAM requirement exceeds the VRAM cap forces CPU
 * to prevent GPU out-of-memory (OOM) driver crashes.
 */
export function shouldForceCpu(
  modelSizeBytes: number,
  vramCapBytes: number,
  format: string = 'gguf',
  contextSize: number = 2048
): boolean {
  if (vramCapBytes === Infinity) {
    vramCapBytes = MAX_VRAM_CAP_BYTES;
  }
  if (!Number.isFinite(vramCapBytes) || vramCapBytes <= 0) return true;
  if (!Number.isFinite(modelSizeBytes) || modelSizeBytes <= 0) return false;
  const estimatedPeak = calculateEstimatedPeakRam(modelSizeBytes, format, contextSize);
  return estimatedPeak > vramCapBytes;
}

export interface GpuGuardOptions {
  modelSizeBytes?: number;
  vramCapBytes?: number;
  format?: string;
  contextSize?: number;
  forcedCpu?: boolean;
}

function checkIsGuardForced(
  guardOptionsOrModelSize?: number | GpuGuardOptions,
  vramCapBytes?: number,
  format?: string,
  contextSize?: number
): boolean {
  if (typeof guardOptionsOrModelSize === 'object' && guardOptionsOrModelSize !== null) {
    if (guardOptionsOrModelSize.forcedCpu === true) {
      return true;
    }
    if (
      typeof guardOptionsOrModelSize.modelSizeBytes === 'number' &&
      typeof guardOptionsOrModelSize.vramCapBytes === 'number'
    ) {
      return shouldForceCpu(
        guardOptionsOrModelSize.modelSizeBytes,
        guardOptionsOrModelSize.vramCapBytes,
        guardOptionsOrModelSize.format,
        guardOptionsOrModelSize.contextSize
      );
    }
    return false;
  }

  if (typeof guardOptionsOrModelSize === 'number' && typeof vramCapBytes === 'number') {
    return shouldForceCpu(guardOptionsOrModelSize, vramCapBytes, format, contextSize);
  }

  return false;
}

/**
 * Resolves effective GPU backend preference, honouring user override if specified
 * and enforcing GPU guards (VRAM cap exceedance and Tensor Gemma stability guards).
 */
export function getGpuBackendPreference(
  vendor: GpuVendor,
  userOverride?: 'auto' | 'opencl' | 'vulkan' | 'cpu',
  modelName?: string,
  guardOptionsOrModelSize?: number | GpuGuardOptions,
  vramCapBytes?: number,
  format?: string,
  contextSize?: number
): GpuBackend {
  // Explicit CPU override always wins
  if (userOverride === 'cpu') {
    return 'cpu';
  }

  // GPU-guard evaluation (model exceeds VRAM cap)
  const isGuardForced = checkIsGuardForced(
    guardOptionsOrModelSize,
    vramCapBytes,
    format,
    contextSize
  );

  if (isGuardForced) {
    return 'cpu';
  }

  // Explicit user override (opencl / vulkan) honoured if guard did not force CPU
  if (userOverride && userOverride !== 'auto') {
    return userOverride;
  }

  // Tensor + Gemma guard
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
  if (modelSizeBytes === Infinity) return Infinity;
  const safeSize = Number.isFinite(modelSizeBytes) && modelSizeBytes > 0 ? modelSizeBytes : 0;
  const normFormat = (typeof format === 'string' ? format : '').toLowerCase().replace(/^\./, '');
  const multiplier = FORMAT_RAM_MULTIPLIERS[normFormat] ?? 1.35;
  const safeContext = Number.isFinite(contextSize) && contextSize > 0 ? contextSize : 0;
  const kvCache = safeContext * KV_CACHE_BYTES_PER_TOKEN;
  return Math.round(safeSize * multiplier + kvCache);
}

/**
 * Size-driven tier status: peak RAM (size * FORMAT_RAM_MULTIPLIERS[format] +
 * contextSize * KV_CACHE_BYTES_PER_TOKEN) as a fraction of device RAM.
 * <50% recommended, 50-75% borderline, >75% unsupported.
 *
 * For unreadable, non-finite, or non-positive RAM values, fails safe to 'unsupported'
 * because sufficient memory cannot be verified to prevent OOM termination.
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
  if (!Number.isFinite(ramBytes) || ramBytes <= 0) return 'unsupported';
  if (ramBytes === Infinity) return 'recommended';
  if (!Number.isFinite(modelSizeBytes) || modelSizeBytes <= 0) return 'unsupported';
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
 * Aligned with PrivateLM tier boundaries: <=4 GB, 4-6 GB, 6-8 GB, >8 GB.
 *
 * | Model                    | Size     | <=4 GB     | 4-6 GB     | 6-8 GB     | >8 GB      |
 * |--------------------------|----------|------------|------------|------------|-----------|
 * | Needle-2 45M             | ~0.014 GB| recommended| recommended| recommended| recommended|
 * | Needle-3 (20-layer)      | ~0.035 GB| recommended| recommended| recommended| recommended|
 * | SmolLM 135M              | ~0.16 GB | recommended| recommended| recommended| recommended|
 * | Qwen2.5 0.5B             | ~0.52 GB | borderline | recommended| recommended| recommended|
 * | Llama 3.2 1B (GGUF)      | ~0.81 GB | unsupported| recommended| recommended| recommended|
 * | TinyLlama 1.1B           | ~1.1 GB  | unsupported| borderline | recommended| recommended|
 * | Qwen2.5 1.5B (GGUF)      | ~1.06 GB | unsupported| borderline | recommended| recommended|
 * | DeepSeek-R1 1.5B (GGUF)  | ~1.06 GB | unsupported| borderline | recommended| recommended|
 * | Qwen2.5 1.5B             | ~1.5 GB  | unsupported| borderline | recommended| recommended|
 * | DeepSeek-R1 1.5B         | ~1.9 GB  | unsupported| borderline | recommended| recommended|
 * | Phi-4 Mini (GGUF)        | ~2.5 GB  | unsupported| unsupported| recommended| recommended|
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

  // If RAM is not finite or <= 4 GB, resolve to lowest tier (fail-safe to low tier on NaN/<=0)
  if (!Number.isFinite(ramBytes) || ramGB <= 4) {
    if (ramBytes === Infinity) {
      return 'recommended';
    }
    if (
      modelName === 'Needle-2 45M' ||
      modelName === 'Needle-3 (20-layer)' ||
      modelName === 'SmolLM 135M'
    ) {
      return 'recommended';
    }
    if (modelName === 'Qwen2.5 0.5B') return 'borderline';
    return 'unsupported';
  } else if (ramGB <= 6) {
    if (
      modelName === 'Needle-2 45M' ||
      modelName === 'Needle-3 (20-layer)' ||
      modelName === 'SmolLM 135M' ||
      modelName === 'Qwen2.5 0.5B' ||
      modelName === 'Llama 3.2 1B (GGUF)'
    ) {
      return 'recommended';
    }
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
    // High tier (>6 GB, including 8 GB and >8 GB) - all models recommended
    return 'recommended';
  }
}

/**
 * Returns optimal inference settings for the device's RAM tier aligned with PrivateLM:
 * - <= 4 GB:  SmolLM 135M,            ctx 1024, max 256
 * - <= 6 GB:  Qwen2.5 0.5B,           ctx 2048, max 512
 * - <= 8 GB:  Qwen2.5 1.5B (GGUF),    ctx 4096, max 1024
 * - > 8 GB:   Qwen2.5 1.5B (GGUF),    ctx 8192, max 4096
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

  // If RAM is not finite or <= 4 GB, resolve to lowest tier (fail-safe to low tier on NaN/<=0)
  if (!Number.isFinite(ramBytes) || ramGB <= 4) {
    if (ramBytes === Infinity) {
      return {
        modelName: 'Qwen2.5 1.5B (GGUF)',
        contextSize: 8192,
        maxTokens: 4096,
      };
    }
    return {
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    };
  } else if (ramGB <= 6) {
    return {
      modelName: 'Qwen2.5 0.5B',
      contextSize: 2048,
      maxTokens: 512,
    };
  } else if (ramGB <= 8) {
    return {
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 4096,
      maxTokens: 1024,
    };
  } else {
    return {
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 8192,
      maxTokens: 4096,
    };
  }
}

export interface SafeInferencePlan {
  contextSize: number;
  maxTokens: number;
  backend: GpuBackend;
  vramCapBytes: number;
  forcedCpu: boolean;
  status: ModelRecommendationStatus;
}

/**
 * Composed helper returning a complete inference plan combining VRAM cap,
 * GPU guard, RAM tier settings, and hardware fail-safes.
 */
export function getSafeInferencePlan(
  ramBytes: number,
  modelSizeBytes: number,
  format: string,
  vendor: GpuVendor = 'unknown',
  override?: 'auto' | 'opencl' | 'vulkan' | 'cpu',
  modelName?: string
): SafeInferencePlan {
  const vramCapBytes = getVramCapBytes(ramBytes);
  const tierSettings = getOptimalSettingsForRam(ramBytes);
  const { contextSize, maxTokens } = tierSettings;
  const forcedCpu = shouldForceCpu(modelSizeBytes, vramCapBytes, format, contextSize);
  const backend = getGpuBackendPreference(vendor, override, modelName, {
    modelSizeBytes,
    vramCapBytes,
    format,
    contextSize,
    forcedCpu,
  });
  const status = getDynamicModelStatusForRam(modelSizeBytes, format, ramBytes, contextSize);

  return {
    contextSize,
    maxTokens,
    backend,
    vramCapBytes,
    forcedCpu,
    status,
  };
}
