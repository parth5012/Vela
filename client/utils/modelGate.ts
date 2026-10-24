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

const MIN_RAM_FLOOR_GB = DEFAULT_RAM_FLOOR_BYTES / BYTES_PER_GB;
const MIN_STORAGE_FLOOR_GB = DEFAULT_MIN_STORAGE_FREE_BYTES / BYTES_PER_GB;

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
  // Fail closed: an undetectable ABI must not be assumed to be arm64.
  return 'unknown';
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
  const allowEmulator = options.allowEmulator ?? false;

  // Resolve RAM (fails closed to 0 if total memory is unavailable)
  let ramBytes = options.ramBytes;
  if (ramBytes === undefined) {
    ramBytes = await detectRamBytes({ allowEmulator });
  }

  // Resolve Free Disk Storage (fails closed to 0 if disk query fails)
  let freeDiskBytes = options.freeDiskBytes;
  if (freeDiskBytes === undefined) {
    try {
      const disk = await FileSystem.getFreeDiskStorageAsync();
      freeDiskBytes = typeof disk === 'number' && disk > 0 ? disk : 0;
    } catch {
      freeDiskBytes = allowEmulator ? 5 * BYTES_PER_GB : 0;
    }
  }

  // Resolve Architecture
  const architecture = options.architecture ?? detectCpuArchitecture();

  const reasons: string[] = [];
  let isArchSupported = false;

  const supportedArm64 = ['arm64-v8a', 'arm64', 'aarch64'];
  if (supportedArm64.includes(architecture)) {
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
  const ramFloorGb = (ramFloor / BYTES_PER_GB).toFixed(0);
  if (ramBytes <= 0) {
    reasons.push('Unable to determine device RAM: total memory is unavailable or unreadable');
  } else if (ramBytes < ramFloor) {
    reasons.push(
      `Insufficient RAM: device has ${ramGb} GB, requires minimum ${ramFloorGb} GB floor for on-device inference`
    );
  }

  const diskGb = (freeDiskBytes / BYTES_PER_GB).toFixed(1);
  const minStorageGb = (minStorage / BYTES_PER_GB).toFixed(0);
  if (freeDiskBytes <= 0) {
    reasons.push('Unable to determine free storage: device disk storage query failed or returned 0');
  } else if (freeDiskBytes < minStorage) {
    reasons.push(
      `Insufficient storage: ${diskGb} GB free, requires minimum ${minStorageGb} GB free storage`
    );
  }

  // Determine status
  if (!isArchSupported || ramBytes < ramFloor || freeDiskBytes < minStorage || ramBytes <= 0 || freeDiskBytes <= 0) {
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
  // sha256 + size verified against the actual HF artifact
  // (sha256sum of the downloaded file == HF LFS oid == x-linked-etag).
  sizeBytes: 1553670064,
  sha256: '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45',
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchFn(remoteUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.ok) {
      const data = await response.json();
      const isValidHex64 = typeof data?.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(data.sha256);
      const isValidHttps = typeof data?.downloadUrl === 'string' && data.downloadUrl.startsWith('https://');
      const isValidSize = typeof data?.sizeBytes === 'number' && data.sizeBytes > 0;
      const isValidFormat = ['litertlm', 'task', 'gguf', 'cact'].includes(data?.format);
      const isValidModelId = typeof data?.modelId === 'string' && data.modelId.trim().length > 0;
      const isValidRamFloor =
        data?.minRamGb === undefined ||
        data?.minRamGb === null ||
        (typeof data.minRamGb === 'number' && data.minRamGb >= MIN_RAM_FLOOR_GB);
      const isValidStorageFloor =
        data?.minStorageGb === undefined ||
        data?.minStorageGb === null ||
        (typeof data.minStorageGb === 'number' && data.minStorageGb >= MIN_STORAGE_FLOOR_GB);

      if (
        isValidModelId &&
        isValidHttps &&
        isValidSize &&
        isValidHex64 &&
        isValidFormat &&
        isValidRamFloor &&
        isValidStorageFloor
      ) {
        return {
          modelId: data.modelId,
          name: data.name || data.modelId,
          downloadUrl: data.downloadUrl,
          filename: data.filename || `${data.modelId}.${data.format}`,
          format: data.format,
          sizeBytes: data.sizeBytes,
          sha256: data.sha256,
          minRamGb: typeof data.minRamGb === 'number' && data.minRamGb > 0 ? data.minRamGb : MIN_RAM_FLOOR_GB,
          minStorageGb:
            typeof data.minStorageGb === 'number' && data.minStorageGb > 0
              ? data.minStorageGb
              : MIN_STORAGE_FLOOR_GB,
        };
      } else {
        console.warn('[ModelGate] Remote config validation failed, using fallback config:', data);
      }
    }
  } catch (err) {
    console.warn('[ModelGate] Remote config fetch failed, using fallback config:', err);
  } finally {
    clearTimeout(timeout);
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
 *
 * `hashProvider` is required and must compute the digest over the raw file
 * bytes (e.g. a native streaming hasher). No fs/Base64 fallback exists:
 * hashing Base64 text can never equal the file's sha256, and presence/size
 * checks are not integrity checks. If the provider is missing or throws,
 * verification fails closed (returns `false`).
 *
 * Note: not yet called by the download path — wiring post-download
 * verification into `ResumableModelDownloader` is tracked separately.
 */
export async function verifyArtifactIntegrity(
  fileUri: string,
  expectedSha256: string,
  hashProvider: (uri: string) => Promise<string>
): Promise<boolean> {
  if (typeof hashProvider !== 'function') {
    console.warn(
      '[ModelGate] No hashProvider supplied; failing closed instead of trusting an unverified artifact.'
    );
    return false;
  }

  try {
    const calculated = await hashProvider(fileUri);
    if (typeof calculated !== 'string' || calculated.length === 0) {
      console.warn('[ModelGate] hashProvider returned no digest; failing closed.');
      return false;
    }
    return calculated.toLowerCase() === expectedSha256.toLowerCase();
  } catch (err) {
    console.warn('[ModelGate] Integrity verification failed; failing closed:', err);
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
    deleteAsync: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  }
): Promise<{ recovered: boolean }> {
  const deleter = storage?.deleteAsync ?? FileSystem.deleteAsync;
  const remover = storage?.removeItem ?? AsyncStorage.removeItem;

  console.warn(`[ModelGate] Purging corrupt artifact for model ${modelId} at ${fileUri}`);

  let deleteSucceeded = false;
  try {
    await deleter(fileUri, { idempotent: true });
    deleteSucceeded = true;
  } catch (e) {
    console.warn('[ModelGate] Failed to delete corrupt file:', e);
  }

  const [resumeResult, statusResult] = await Promise.allSettled([
    remover(`download_resume_${modelId}`),
    remover(`model_status_${modelId}`),
  ]);

  if (resumeResult.status === 'rejected') {
    console.warn('[ModelGate] Failed to clear storage resume key:', resumeResult.reason);
  }
  if (statusResult.status === 'rejected') {
    console.warn('[ModelGate] Failed to clear storage status key:', statusResult.reason);
  }

  const storageCleared = resumeResult.status === 'fulfilled' && statusResult.status === 'fulfilled';
  return { recovered: deleteSucceeded && storageCleared };
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
    const modelConfig = await fetchRemoteModelConfig(
      this.options.remoteConfigUrl,
      this.options.fetchFn
    );

    const callerCapabilityOptions = this.options.capabilityOptions ?? {};
    // Effective floors are the highest of the model config, the documented
    // defaults, and caller overrides: remote payloads and callers can raise
    // requirements but never weaken the hard 6 GB / 3 GB floors.
    const capabilityOptions: DeviceCapabilityOptions = {
      ...callerCapabilityOptions,
      ramFloorBytes: Math.max(
        modelConfig.minRamGb * BYTES_PER_GB,
        DEFAULT_RAM_FLOOR_BYTES,
        callerCapabilityOptions.ramFloorBytes ?? 0
      ),
      minDiskFreeBytes: Math.max(
        modelConfig.minStorageGb * BYTES_PER_GB,
        DEFAULT_MIN_STORAGE_FREE_BYTES,
        callerCapabilityOptions.minDiskFreeBytes ?? 0
      ),
    };
    const capability = await evaluateDeviceCapabilities(capabilityOptions);

    if (capability.status === 'UNSUPPORTED') {
      return {
        ready: false,
        capability,
        modelConfig,
        error: capability.reasons.join('; '),
      };
    }

    const networkPolicy: NetworkDownloadPolicy = {
      isWifi: this.options.networkOptions?.isWifi ?? false,
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

export interface DownloadProgress {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  progressPercent: number;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export interface ResumableDownloaderOptions {
  modelConfig: ModelArtifactConfig;
  destinationUri?: string;
  onProgress?: DownloadProgressCallback;
  storage?: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  };
  createDownloadResumableFn?: (
    url: string,
    fileUri: string,
    options?: any,
    callback?: (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
    resumeData?: string
  ) => {
    downloadAsync: () => Promise<{ uri: string; status: number } | undefined>;
    pauseAsync: () => Promise<{ resumeData: string }>;
    resumeAsync: () => Promise<{ uri: string; status: number } | undefined>;
  };
}

/**
 * Manages streaming resumable downloads for large on-device model artifacts with pause/resume support.
 */
export class ResumableModelDownloader {
  private config: ModelArtifactConfig;
  private destinationUri: string;
  private onProgress?: DownloadProgressCallback;
  private storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  };
  private createDownloadResumableFn: any;
  private downloadInstance: any = null;
  private initPromise: Promise<void> | null = null;
  private isDownloading: boolean = false;
  private lastProgress: DownloadProgress = {
    totalBytesWritten: 0,
    totalBytesExpectedToWrite: 0,
    progressPercent: 0,
  };

  constructor(options: ResumableDownloaderOptions) {
    this.config = options.modelConfig;
    this.destinationUri =
      options.destinationUri ??
      `${FileSystem.documentDirectory ?? '/data/models/'}${this.config.filename}`;
    this.onProgress = options.onProgress;
    this.storage = options.storage ?? AsyncStorage;
    this.createDownloadResumableFn =
      options.createDownloadResumableFn ?? FileSystem.createDownloadResumable;
  }

  get resumeKey(): string {
    return `download_resume_${this.config.modelId}`;
  }

  getProgress(): DownloadProgress {
    return this.lastProgress;
  }

  async start(): Promise<string | null> {
    this.isDownloading = true;
    this.initPromise = this.initializeDownload();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }

    try {
      const result = await this.downloadInstance.downloadAsync();
      this.isDownloading = false;
      if (!result || !result.uri) {
        // Paused or cancelled by caller; retain resume token in storage
        return null;
      }
      await this.storage.removeItem(this.resumeKey);
      return result.uri;
    } catch (err) {
      this.isDownloading = false;
      throw err;
    }
  }

  private async initializeDownload(): Promise<void> {
    const savedResumeData = await this.storage.getItem(this.resumeKey);

    const progressHandler = ({
      totalBytesWritten,
      totalBytesExpectedToWrite,
    }: {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    }) => {
      const expected = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : this.config.sizeBytes;
      const percent = expected > 0 ? Math.min(100, Math.round((totalBytesWritten / expected) * 100)) : 0;
      this.lastProgress = {
        totalBytesWritten,
        totalBytesExpectedToWrite: expected,
        progressPercent: percent,
      };
      this.onProgress?.(this.lastProgress);
    };

    this.downloadInstance = this.createDownloadResumableFn(
      this.config.downloadUrl,
      this.destinationUri,
      {},
      progressHandler,
      savedResumeData ?? undefined
    );
  }

  async pause(): Promise<string | null> {
    if (this.initPromise) {
      // Deterministically wait for download initialization instead of a fixed
      // sleep, so a pause issued during start() is never silently dropped.
      await this.initPromise.catch(() => undefined);
    }

    if (!this.downloadInstance || !this.isDownloading) {
      return null;
    }

    try {
      const snapshot = await this.downloadInstance.pauseAsync();
      if (snapshot?.resumeData) {
        await this.storage.setItem(this.resumeKey, snapshot.resumeData);
        return snapshot.resumeData;
      }
    } catch (err) {
      console.warn('[ResumableModelDownloader] Pause failed:', err);
    } finally {
      this.isDownloading = false;
    }
    return null;
  }

  async resume(): Promise<string | null> {
    if (!this.downloadInstance) {
      return this.start();
    }

    this.isDownloading = true;
    try {
      const result = await this.downloadInstance.resumeAsync();
      this.isDownloading = false;
      if (!result || !result.uri) {
        // Paused or cancelled by caller; retain resume token in storage
        return null;
      }
      await this.storage.removeItem(this.resumeKey);
      return result.uri;
    } catch (err) {
      this.isDownloading = false;
      throw err;
    }
  }

  async cancel(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise.catch(() => undefined);
    }
    if (this.downloadInstance && this.isDownloading) {
      try {
        await this.downloadInstance.pauseAsync();
      } catch {
        // Ignore error on abort
      }
    }
    this.isDownloading = false;
    await this.storage.removeItem(this.resumeKey);
  }
}
