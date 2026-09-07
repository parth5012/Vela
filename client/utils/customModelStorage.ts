import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

export type SupportedModelFormat = 'cact' | 'gguf' | 'task';

export interface CustomModelRecord {
  id: string;
  name: string;
  format: SupportedModelFormat;
  sizeBytes: number;
  localUri: string;
  source: 'url' | 'document_picker';
  sourceUrl?: string;
  downloadDate: string;
  contextSize?: number;
  isCorrupted?: boolean;
}

export interface CustomModelDownloadSpec {
  id: string;
  name: string;
  url: string;
  format: SupportedModelFormat;
  contextSize?: number;
}

export interface CustomModelDownloadProgress {
  modelId: string;
  bytesWritten: number;
  totalBytesExpected: number;
  progressFraction: number;
  status: 'downloading' | 'paused' | 'completed' | 'error';
  error?: string;
}

const CUSTOM_MODELS_STORAGE_KEY = 'custom_local_models_list';
const RESUME_PREFIX = 'download_resume_';

// Active in-memory download resumable handles
const activeDownloads = new Map<string, FileSystem.DownloadResumable>();

/**
 * Sniffs first bytes of a binary buffer to detect model format.
 * Returns 'cact', 'gguf', 'task', or null if invalid/unknown.
 */
export function sniffMagicBytes(bytes: Uint8Array): SupportedModelFormat | null {
  if (!bytes || bytes.length < 4) {
    return null;
  }

  // Needle (.cact):
  // Needle 2: 0x05E12A83 -> Little-endian: 0x83, 0x2A, 0xE1, 0x05
  // Needle 3: 0x05E12A84 -> Little-endian: 0x84, 0x2A, 0xE1, 0x05
  if (
    bytes[0] === 0x83 &&
    bytes[1] === 0x2a &&
    bytes[2] === 0xe1 &&
    bytes[3] === 0x05
  ) {
    return 'cact';
  }
  if (
    bytes[0] === 0x84 &&
    bytes[1] === 0x2a &&
    bytes[2] === 0xe1 &&
    bytes[3] === 0x05
  ) {
    return 'cact';
  }

  // GGUF (.gguf):
  // ASCII 'GGUF' -> 0x47, 0x47, 0x55, 0x46
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x47 &&
    bytes[2] === 0x55 &&
    bytes[3] === 0x46
  ) {
    return 'gguf';
  }

  // LiteRT (.task):
  // PKZip header 'PK\x03\x04' -> 0x50, 0x4B, 0x03, 0x04
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return 'task';
  }

  return null;
}

/**
 * Preflights a remote URL using HTTP Range: bytes=0-15 to sniff magic bytes
 * before downloading large multi-gigabyte models.
 */
export async function preflightUrlMagicBytes(
  url: string
): Promise<{
  format: SupportedModelFormat | null;
  valid: boolean;
  contentLength?: number;
  error?: string;
}> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { format: null, valid: false, error: 'URL must use http or https protocol' };
    }
  } catch {
    return { format: null, valid: false, error: 'Invalid URL format' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-15',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 206) {
      return {
        format: null,
        valid: false,
        error: `HTTP status ${response.status} fetching preflight range header`,
      };
    }

    let bytes: Uint8Array;
    // If response is streaming, read only the first chunk up to 16 bytes
    if (response.body && typeof (response.body as any).getReader === 'function') {
      const reader = (response.body as any).getReader();
      const chunk = await reader.read();
      reader.cancel();
      bytes = chunk.value ? chunk.value.slice(0, 16) : new Uint8Array(0);
    } else {
      const cl = response.headers.get('content-length');
      if (cl && parseInt(cl, 10) > 1024 * 1024 && response.status === 200) {
        return {
          format: null,
          valid: false,
          error: 'Server does not support partial range preflight',
        };
      }
      const arrayBuffer = await response.arrayBuffer();
      bytes = new Uint8Array(arrayBuffer.slice(0, 16));
    }

    const detectedFormat = sniffMagicBytes(bytes);

    let contentLength: number | undefined;
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const parts = contentRange.split('/');
      if (parts[1]) {
        contentLength = parseInt(parts[1], 10);
      }
    } else {
      const cl = response.headers.get('content-length');
      if (cl) {
        contentLength = parseInt(cl, 10);
      }
    }

    return {
      format: detectedFormat,
      valid: detectedFormat !== null,
      contentLength,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      format: null,
      valid: false,
      error: err?.message || 'Network error during preflight request',
    };
  }
}

/**
 * Validates magic bytes of an existing local file.
 */
export async function validateFileMagicBytes(
  filePath: string
): Promise<{ format: SupportedModelFormat | null; valid: boolean }> {
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) {
      return { format: null, valid: false };
    }

    // Read first chunk in base64
    const base64Data = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
      length: 16,
      position: 0,
    });

    if (!base64Data) {
      return { format: null, valid: false };
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const format = sniffMagicBytes(bytes);
    return { format, valid: format !== null };
  } catch {
    return { format: null, valid: false };
  }
}

/**
 * Storage directory helper ensuring directory exists.
 */
export async function getModelDirectory(format: SupportedModelFormat): Promise<string> {
  const dir = `${FileSystem.documentDirectory}models/${format}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Retrieves list of installed custom models from AsyncStorage.
 */
export async function getCustomModels(): Promise<CustomModelRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Saves or updates a custom model record in manifest.
 */
export async function saveCustomModel(model: CustomModelRecord): Promise<void> {
  const existing = await getCustomModels();
  const index = existing.findIndex((m) => m.id === model.id);
  if (index >= 0) {
    existing[index] = model;
  } else {
    existing.push(model);
  }
  await AsyncStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(existing));
}

/**
 * Deletes a custom model from storage and manifest.
 */
export async function deleteCustomModel(modelId: string): Promise<boolean> {
  const existing = await getCustomModels();
  const target = existing.find((m) => m.id === modelId);
  if (!target) return false;

  try {
    const info = await FileSystem.getInfoAsync(target.localUri);
    if (info.exists) {
      await FileSystem.deleteAsync(target.localUri, { idempotent: true });
    }
  } catch (e) {
    console.warn(`[customModelStorage] Failed to delete file ${target.localUri}:`, e);
  }

  const filtered = existing.filter((m) => m.id !== modelId);
  await AsyncStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(filtered));
  await AsyncStorage.removeItem(RESUME_PREFIX + modelId);
  activeDownloads.delete(modelId);
  return true;
}

/**
 * Imports a local model file (e.g. from DocumentPicker) into Vela storage.
 */
export async function importModelFromFile(
  fileUri: string,
  fileName: string
): Promise<CustomModelRecord> {
  // Sniff or guess format from extension
  let format: SupportedModelFormat = 'cact';
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.gguf')) {
    format = 'gguf';
  } else if (lowerName.endsWith('.task')) {
    format = 'task';
  } else if (lowerName.endsWith('.cact')) {
    format = 'cact';
  }

  const destDir = await getModelDirectory(format);
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const modelId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const destUri = `${destDir}${modelId}_${sanitizedName}`;

  await FileSystem.copyAsync({
    from: fileUri,
    to: destUri,
  });

  const fileInfo = await FileSystem.getInfoAsync(destUri);
  const sizeBytes = (fileInfo as any).size || 0;

  const record: CustomModelRecord = {
    id: modelId,
    name: fileName.replace(/\.[^/.]+$/, ''),
    format,
    sizeBytes,
    localUri: destUri,
    source: 'document_picker',
    downloadDate: new Date().toISOString(),
  };

  await saveCustomModel(record);
  return record;
}

/**
 * Starts a resumable download for a custom model.
 */
export async function startCustomModelDownload(
  spec: CustomModelDownloadSpec,
  onProgress?: (progress: CustomModelDownloadProgress) => void
): Promise<string> {
  const destDir = await getModelDirectory(spec.format);
  const sanitizedId = spec.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedName = spec.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const destUri = `${destDir}${sanitizedId}_${sanitizedName}.${spec.format}`;

  const downloadCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
    const fraction =
      downloadProgress.totalBytesExpectedToWrite > 0
        ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
        : 0;

    if (onProgress) {
      onProgress({
        modelId: spec.id,
        bytesWritten: downloadProgress.totalBytesWritten,
        totalBytesExpected: downloadProgress.totalBytesExpectedToWrite,
        progressFraction: fraction,
        status: 'downloading',
      });
    }
  };

  // Check if we have saved resumable download state
  const savedResume = await AsyncStorage.getItem(RESUME_PREFIX + spec.id);
  let downloadResumable: FileSystem.DownloadResumable;

  if (savedResume) {
    try {
      const resumeData = JSON.parse(savedResume);
      downloadResumable = new (FileSystem.DownloadResumable as any)(
        resumeData.url,
        resumeData.fileUri,
        resumeData.options,
        downloadCallback,
        resumeData.resumeData
      );
    } catch {
      downloadResumable = FileSystem.createDownloadResumable(
        spec.url,
        destUri,
        {},
        downloadCallback
      );
    }
  } else {
    downloadResumable = FileSystem.createDownloadResumable(
      spec.url,
      destUri,
      {},
      downloadCallback
    );
  }

  activeDownloads.set(spec.id, downloadResumable);

  try {
    const result = await downloadResumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error('Download failed to return local uri');
    }

    const info = await FileSystem.getInfoAsync(result.uri);
    const sizeBytes = (info as any).size || 0;

    const record: CustomModelRecord = {
      id: spec.id,
      name: spec.name,
      format: spec.format,
      sizeBytes,
      localUri: result.uri,
      source: 'url',
      sourceUrl: spec.url,
      downloadDate: new Date().toISOString(),
      contextSize: spec.contextSize,
    };

    await saveCustomModel(record);
    await AsyncStorage.removeItem(RESUME_PREFIX + spec.id);
    activeDownloads.delete(spec.id);

    if (onProgress) {
      onProgress({
        modelId: spec.id,
        bytesWritten: sizeBytes,
        totalBytesExpected: sizeBytes,
        progressFraction: 1,
        status: 'completed',
      });
    }

    return result.uri;
  } catch (err: any) {
    if (onProgress) {
      onProgress({
        modelId: spec.id,
        bytesWritten: 0,
        totalBytesExpected: 0,
        progressFraction: 0,
        status: 'error',
        error: err?.message,
      });
    }
    throw err;
  }
}

/**
 * Pauses an active model download and saves resume snapshot.
 */
export async function pauseCustomModelDownload(modelId: string): Promise<void> {
  const download = activeDownloads.get(modelId);
  if (download) {
    const savable = await download.pauseAsync();
    await AsyncStorage.setItem(RESUME_PREFIX + modelId, JSON.stringify(savable));
  }
}

/**
 * Resumes a paused model download.
 */
export async function resumeCustomModelDownload(
  modelId: string,
  onProgress?: (progress: CustomModelDownloadProgress) => void
): Promise<string> {
  let download = activeDownloads.get(modelId);
  if (!download) {
    const savedResume = await AsyncStorage.getItem(RESUME_PREFIX + modelId);
    if (savedResume) {
      try {
        const resumeData = JSON.parse(savedResume);
        const downloadCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
          const fraction =
            downloadProgress.totalBytesExpectedToWrite > 0
              ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
              : 0;
          if (onProgress) {
            onProgress({
              modelId,
              bytesWritten: downloadProgress.totalBytesWritten,
              totalBytesExpected: downloadProgress.totalBytesExpectedToWrite,
              progressFraction: fraction,
              status: 'downloading',
            });
          }
        };
        download = new (FileSystem.DownloadResumable as any)(
          resumeData.url,
          resumeData.fileUri,
          resumeData.options,
          downloadCallback,
          resumeData.resumeData
        );
        activeDownloads.set(modelId, download!);
      } catch {}
    }
  }

  if (!download) {
    throw new Error(`No active download found for model id ${modelId}`);
  }

  const result = await download.resumeAsync();
  if (!result || !result.uri) {
    throw new Error('Resume download failed');
  }

  await AsyncStorage.removeItem(RESUME_PREFIX + modelId);
  activeDownloads.delete(modelId);
  return result.uri;
}

/**
 * Cancels a download and removes partial file.
 */
export async function cancelCustomModelDownload(modelId: string): Promise<void> {
  const download = activeDownloads.get(modelId);
  if (download) {
    try {
      await download.pauseAsync();
    } catch {
      // Ignore pause failure during cancel
    }
  }
  await AsyncStorage.removeItem(RESUME_PREFIX + modelId);
  activeDownloads.delete(modelId);
}
