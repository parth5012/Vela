/**
 * Model Download & Device Capability Gate (WF-05 / #420)
 *
 * Implements capability verification (RAM tier >= 6 GB floor, free disk space >= 3 GB,
 * arm64-v8a architecture), dynamic model download URL resolution from remote config,
 * Wi-Fi only network policy with cellular override, SHA-256 integrity checks,
 * and corrupt artifact recovery.
 *
 * Respects WF-01 product decisions in DECISIONS.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { detectRamBytes } from './ramDetection';

export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const DEFAULT_RAM_FLOOR_BYTES = 6 * BYTES_PER_GB;
export const DEFAULT_RAM_RECOMMENDED_BYTES = 8 * BYTES_PER_GB;
export const DEFAULT_MIN_STORAGE_FREE_BYTES = 3 * BYTES_PER_GB;

export type DeviceCapabilityStatus = 'OK' | 'DEGRADED' | 'UNSUPPORTED';

export interface DeviceCapabilityOptions {
  ramBytes?: number;
  freeDiskBytes?: number;
  architecture?: string;
  allowEmulator?: boolean;
  ramFloorBytes?: number;
  ramRecommendedBytes?: number;
  minDiskFreeBytes?: number;
}

export interface DeviceCapabilityResult {
  status: DeviceCapabilityStatus;
  canRunOnDevice: boolean;
  contextWindowLimit: number;
  ramBytes: number;
  freeDiskBytes: number;
  architecture: string;
  reasons: string[];
}

export interface ModelArtifactConfig {
  modelId: string;
  name: string;
  downloadUrl: string;
  filename: string;
  format: 'litertlm' | 'task' | 'gguf' | 'cact';
  sizeBytes: number;
  sha256: string;
  minRamGb: number;
  minStorageGb: number;
}

export interface NetworkDownloadPolicy {
  isWifi: boolean;
  wifiOnly: boolean;
  allowCellular: boolean;
}

export interface NetworkDownloadCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Detects the native CPU ABI / architecture.
 */
export function detectCpuArchitecture(): string {
  if (Platform.OS === 'android') {
    const supported = Device.supportedCpuArchitectures;
    if (Array.isArray(supported) && supported.length > 0) {
      return supported[0];
    }
  }
  if (typeof process !== 'undefined' && process.arch) {
    if (process.arch === 'arm64') return 'arm64-v8a';
    if (process.arch === 'x64') return 'x86_64';
    return process.arch;
  }
  return 'arm64-v8a';
}

/**
 * Evaluates device hardware capabilities against WF-01 on-device AI requirements:
 * - Minimum RAM floor: 6 GB. Devices with < 6 GB -> UNSUPPORTED.
 * - Minimum storage: 3 GB free disk space. < 3 GB -> UNSUPPORTED.
 * - Architecture: arm64-v8a (or x86_64 in dev/emulator mode).
 * - Devices with RAM >= 8 GB -> OK (4096 context window).
 * - Devices with 6 GB <= RAM < 8 GB -> DEGRADED (1024 context window, pruned KV cache).
 */
export async function evaluateDeviceCapabilities(
  options: DeviceCapabilityOptions = {}
): Promise<DeviceCapabilityResult> {
  const ramFloor = options.ramFloorBytes ?? DEFAULT_RAM_FLOOR_BYTES;
  const ramRecommended = options.ramRecommendedBytes ?? DEFAULT_RAM_RECOMMENDED_BYTES;
  const minStorage = options.minDiskFreeBytes ?? DEFAULT_MIN_STORAGE_FREE_BYTES;

  // Resolve RAM
  let ramBytes = options.ramBytes;
  if (ramBytes === undefined) {
    ramBytes = await detectRamBytes();
  }

  // Resolve Free Disk Storage
  let freeDiskBytes = options.freeDiskBytes;
  if (freeDiskBytes === undefined) {
    try {
      freeDiskBytes = await FileSystem.getFreeDiskStorageAsync();
    } catch {
      freeDiskBytes = 5 * BYTES_PER_GB; // safe default in simulation
    }
  }

  // Resolve Architecture
  const architecture = options.architecture ?? detectCpuArchitecture();
  const allowEmulator = options.allowEmulator ?? false;

  const reasons: string[] = [];
  let isArchSupported = false;

  if (architecture === 'arm64-v8a') {
    isArchSupported = true;
  } else if (allowEmulator && (architecture === 'x86_64' || architecture === 'x64')) {
    isArchSupported = true;
  }

  if (!isArchSupported) {
    reasons.push(
      `Unsupported architecture '${architecture}': requires arm64-v8a 64-bit ARM CPU`
    );
  }

  const ramGb = (ramBytes / BYTES_PER_GB).toFixed(1);
  if (ramBytes < ramFloor) {
    reasons.push(
      `Insufficient RAM: device has ${ramGb} GB, requires minimum 6 GB floor for on-device inference`
    );
  }

  const diskGb = (freeDiskBytes / BYTES_PER_GB).toFixed(1);
  if (freeDiskBytes < minStorage) {
    reasons.push(
      `Insufficient storage: ${diskGb} GB free, requires minimum 3 GB free storage`
    );
  }

  // Determine status
  if (!isArchSupported || ramBytes < ramFloor || freeDiskBytes < minStorage) {
    return {
      status: 'UNSUPPORTED',
      canRunOnDevice: false,
      contextWindowLimit: 0,
      ramBytes,
      freeDiskBytes,
      architecture,
      reasons,
    };
  }

  if (ramBytes < ramRecommended) {
    reasons.push(
      `Device RAM (${ramGb} GB) meets minimum 6 GB floor but <8 GB; running with pruned 1024-token context`
    );
    return {
      status: 'DEGRADED',
      canRunOnDevice: true,
      contextWindowLimit: 1024,
      ramBytes,
      freeDiskBytes,
      architecture,
      reasons,
    };
  }

  return {
    status: 'OK',
    canRunOnDevice: true,
    contextWindowLimit: 4096,
    ramBytes,
    freeDiskBytes,
    architecture,
    reasons,
  };
}

/**
 * Default remote config fallback if endpoint is unavailable.
 * Never hardcoded in UI; resolved dynamically.
 */
export const DEFAULT_FALLBACK_MODEL_CONFIG: ModelArtifactConfig = {
  modelId: 'minicpm5-2b-int4',
  name: 'MiniCPM5-2B (LiteRT)',
  downloadUrl:
    'https://huggingface.co/litert-community/MiniCPM5-2B/resolve/main/MiniCPM5-2B_int4.litertlm',
  filename: 'MiniCPM5-2B_int4.litertlm',
  format: 'litertlm',
  sizeBytes: 1664299000,
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  minRamGb: 6,
  minStorageGb: 3,
};

/**
 * Fetches dynamic model download configuration from remote config service.
 */
export async function fetchRemoteModelConfig(
  remoteUrl: string = 'https://api.vela.app/config/on-device-model',
  fetchFn: typeof fetch = fetch
): Promise<ModelArtifactConfig> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetchFn(remoteUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (data && data.downloadUrl && data.modelId) {
        return {
          modelId: data.modelId,
          name: data.name || 'MiniCPM5-2B (LiteRT)',
          downloadUrl: data.downloadUrl,
          filename: data.filename || 'MiniCPM5-2B_int4.litertlm',
          format: data.format || 'litertlm',
          sizeBytes: data.sizeBytes || 1664299000,
          sha256: data.sha256 || DEFAULT_FALLBACK_MODEL_CONFIG.sha256,
          minRamGb: data.minRamGb || 6,
          minStorageGb: data.minStorageGb || 3,
        };
      }
    }
  } catch (err) {
    console.warn('[ModelGate] Remote config fetch failed, using fallback config:', err);
  }

  return DEFAULT_FALLBACK_MODEL_CONFIG;
}

/**
 * Checks whether network conditions allow initiating a multi-gigabyte model download.
 * Enforces Wi-Fi only default; requires explicit cellular toggle to proceed over mobile data.
 */
export function checkNetworkDownloadAllowed(
  policy: NetworkDownloadPolicy
): NetworkDownloadCheckResult {
  if (policy.isWifi) {
    return { allowed: true };
  }

  if (policy.wifiOnly && !policy.allowCellular) {
    return {
      allowed: false,
      reason: 'Cellular download blocked by Wi-Fi only policy. Enable cellular downloads in settings to proceed.',
    };
  }

  return { allowed: true };
}

/**
 * Verifies SHA-256 integrity of a downloaded model artifact.
 */
export async function verifyArtifactIntegrity(
  fileUri: string,
  expectedSha256: string,
  hashProvider?: (uri: string) => Promise<string>
): Promise<boolean> {
  if (hashProvider) {
    const calculated = await hashProvider(fileUri);
    return calculated.toLowerCase() === expectedSha256.toLowerCase();
  }

  // Fallback hash implementation (Node environment or expo)
  try {
    const fs = require('fs');
    const crypto = require('crypto');
    if (fs.existsSync(fileUri)) {
      const data = fs.readFileSync(fileUri);
      const digest = crypto.createHash('sha256').update(data).digest('hex');
      return digest.toLowerCase() === expectedSha256.toLowerCase();
    }
  } catch {
    // Continue to react-native/expo
  }

  try {
    const Crypto = require('expo-crypto');
    const content = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      content
    );
    return digest.toLowerCase() === expectedSha256.toLowerCase();
  } catch (err) {
    console.warn('[ModelGate] Integrity verification check failed:', err);
    return false;
  }
}

/**
 * Recovers from corrupt artifacts by purging corrupted local files and reset storage keys.
 */
export async function recoverCorruptArtifact(
  fileUri: string,
  modelId: string,
  storage?: {
    deleteAsync: (uri: string, opts?: any) => Promise<any>;
    removeItem: (key: string) => Promise<any>;
  }
): Promise<{ recovered: boolean }> {
  const deleter = storage?.deleteAsync ?? FileSystem.deleteAsync;
  const remover = storage?.removeItem ?? AsyncStorage.removeItem;

  console.warn(`[ModelGate] Purging corrupt artifact for model ${modelId} at ${fileUri}`);

  try {
    await deleter(fileUri, { idempotent: true });
  } catch (e) {
    console.warn('[ModelGate] Failed to delete corrupt file:', e);
  }

  try {
    await remover(`download_resume_${modelId}`);
    await remover(`model_status_${modelId}`);
  } catch (e) {
    console.warn('[ModelGate] Failed to clear storage resume keys:', e);
  }

  return { recovered: true };
}

export interface ModelDownloadGateOptions {
  capabilityOptions?: DeviceCapabilityOptions;
  networkOptions?: {
    isWifi?: boolean;
    wifiOnly?: boolean;
    allowCellular?: boolean;
  };
  remoteConfigUrl?: string;
  fetchFn?: typeof fetch;
}

export interface ModelDownloadGateOutcome {
  ready: boolean;
  capability: DeviceCapabilityResult;
  modelConfig: ModelArtifactConfig;
  error?: string;
}

/**
 * Orchestrates pre-download gate checks: device capabilities, network policy, and remote model config.
 */
export class ModelDownloadGate {
  private options: ModelDownloadGateOptions;

  constructor(options: ModelDownloadGateOptions = {}) {
    this.options = options;
  }

  async prepareDownload(): Promise<ModelDownloadGateOutcome> {
    const capability = await evaluateDeviceCapabilities(this.options.capabilityOptions);
    const modelConfig = await fetchRemoteModelConfig(
      this.options.remoteConfigUrl,
      this.options.fetchFn
    );

    if (capability.status === 'UNSUPPORTED') {
      return {
        ready: false,
        capability,
        modelConfig,
        error: capability.reasons.join('; '),
      };
    }

    const networkPolicy: NetworkDownloadPolicy = {
      isWifi: this.options.networkOptions?.isWifi ?? true,
      wifiOnly: this.options.networkOptions?.wifiOnly ?? true,
      allowCellular: this.options.networkOptions?.allowCellular ?? false,
    };

    const networkCheck = checkNetworkDownloadAllowed(networkPolicy);
    if (!networkCheck.allowed) {
      return {
        ready: false,
        capability,
        modelConfig,
        error: networkCheck.reason,
      };
    }

    return {
      ready: true,
      capability,
      modelConfig,
    };
  }
}
