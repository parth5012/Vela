/**
 * Module: client/hooks/useModelDownload
 * Intent: Owns built-in local-model download/manage logic extracted verbatim from app/settings/local-ai.tsx.
 * Responsibilities: downloaded-status tracking, resumable download + cancel, delete/export/import,
 *   RAM load/unload, loaded-in-RAM subscription.
 * Public API: useModelDownload({ customModels, needleHasNative, isMounted }) →
 *   { downloadedModels, modelBusy, isActiveModelDownloaded, isActiveModelLoaded,
 *     handleLoadIntoRam, handleUnloadFromRam, handleDownloadModel, handleCancelDownload,
 *     handleDeleteModel, handleExportModel, handleImportModel }.
 * Invariants: All handler bodies are verbatim moves — no logic changes; the caller's isMounted ref
 *   guards every async continuation (single shared mounted flag with the screen).
 * Side Effects: network downloads, AsyncStorage model markers, filesystem writes/deletes under
 *   documentDirectory/models/, Alert dialogs.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useConfigStore } from '../store/useConfigStore';
import {
  isLocalLlmDown,
  localModelStorageKey,
  LOCAL_MODELS,
  getLoadedModelName,
  subscribeLocalModelLoadedState,
  initializeLocalModel,
  unloadLocalModel,
} from '../utils/localLlm';
import type { CustomModelRecord } from '../utils/customModelStorage';

export interface UseModelDownloadArgs {
  customModels: CustomModelRecord[];
  needleHasNative: boolean;
  isMounted: { current: boolean };
}

export function useModelDownload({ customModels, needleHasNative, isMounted }: UseModelDownloadArgs) {
  const localModelName = useConfigStore((s) => s.localModelName);
  const setLocalModelDownloadProgress = useConfigStore((s) => s.setLocalModelDownloadProgress);
  const wifiOnlyDownload = useConfigStore((s) => s.wifiOnlyDownload);
  const connectionMode = useConfigStore((s) => s.connectionMode);
  const setConnectionMode = useConfigStore((s) => s.setConnectionMode);
  const isLocalMode = connectionMode === 'local';

  const [downloadedModels, setDownloadedModels] = useState<Record<string, boolean>>({});
  const [loadedModelName, setLoadedModelName] = useState<string | null>(getLoadedModelName());
  const [modelBusy, setModelBusy] = useState(false);
  // Active built-in model DownloadResumable so Cancel can pauseAsync + clean up.
  const downloadResumableRef = useRef<any>(null);
  // CodeReview #234: suppresses the erroneous 'Download Failed' alert when the
  // user cancels — the pauseAsync rejection / aborted downloadAsync surfaces
  // through the same catch path as a real network failure.
  const isCancelledRef = useRef(false);

  // Keep the "loaded in RAM" badge in sync with the engine's actual state.
  useEffect(() => {
    const unsubscribe = subscribeLocalModelLoadedState(() => {
      if (isMounted.current) {
        setLoadedModelName(getLoadedModelName());
      }
    });
    setLoadedModelName(getLoadedModelName());
    return unsubscribe;
  }, [isMounted]);

  // Check downloaded status of models on focus/load and when localModelName changes
  useEffect(() => {
    let cancelled = false;

    const checkDownloaded = async () => {
      try {
        const statuses = await Promise.all(
          LOCAL_MODELS.map((m) => AsyncStorage.getItem(localModelStorageKey(m.name)))
        );
        if (cancelled || !isMounted.current) return;
        setDownloadedModels(
          LOCAL_MODELS.reduce<Record<string, boolean>>((acc, model, idx) => {
            acc[model.name] = statuses[idx] === 'true';
            return acc;
          }, {})
        );
      } catch (err) {
        console.warn('[local-ai] Failed to read downloaded model status:', err);
      }
    };

    checkDownloaded();

    return () => {
      cancelled = true;
    };
  }, [localModelName, isMounted]);

  const isActiveModelDownloaded = !!downloadedModels[localModelName];
  const isActiveModelLoaded = loadedModelName === localModelName;

  const handleLoadIntoRam = async () => {
    if (isLocalLlmDown) {
      Alert.alert('Local Model Down', 'The local LLM is currently down/unavailable.');
      return;
    }
    // Wayfinder #230 / #232: block-with-warning on mock Needle runtime (never silent mock).
    // CodeReview #234: gate covers every built-in Needle row (format cact:
    // Needle-2 45M, Needle-3 (20-layer)) AND any custom .cact model
    // (custom .cact models run through the Needle engine, so they bypass silently otherwise).
    const isNeedleModel =
      LOCAL_MODELS.find((m) => m.name === localModelName)?.format === 'cact' ||
      customModels.find((m) => m.name === localModelName)?.format === 'cact';
    if (isNeedleModel && !needleHasNative) {
      Alert.alert(
        'Needle Engine Unavailable',
        'The Needle native library is not packaged in this build (mock fallback stub is active). On-device Needle inference is blocked. Use a dev build with the Needle native module.'
      );
      return;
    }
    if (!isActiveModelDownloaded) {
      Alert.alert('Not Downloaded', `Download ${localModelName} first before loading it into RAM.`);
      return;
    }
    if (modelBusy) return;
    setModelBusy(true);
    try {
      await initializeLocalModel(true);
    } catch (err: any) {
      Alert.alert('Load Failed', err?.message || 'The model could not be loaded.');
    } finally {
      if (isMounted.current) setModelBusy(false);
    }
  };

  const handleUnloadFromRam = async () => {
    if (modelBusy) return;
    setModelBusy(true);
    try {
      await unloadLocalModel();
    } catch (err: any) {
      Alert.alert('Unload Failed', err?.message || 'The model could not be unloaded.');
    } finally {
      if (isMounted.current) setModelBusy(false);
    }
  };

  const handleDownloadModel = async () => {
    if (isLocalLlmDown) {
      Alert.alert('Local Model Down', 'The local LLM is currently down/unavailable.');
      return;
    }

    const selectedModel = LOCAL_MODELS.find((m) => m.name === localModelName);
    if (!selectedModel) {
      Alert.alert('Error', 'Selected model not found.');
      return;
    }

    // Check space
    try {
      const freeBytes = await FileSystem.getFreeDiskStorageAsync();
      const freeGB = freeBytes / (1024 * 1024 * 1024);
      const sizeMatch = selectedModel.size.match(/([\d.]+)/);
      const requiredSpace = sizeMatch ? parseFloat(sizeMatch[1]) * 1.2 : 2.0;

      if (freeGB < requiredSpace) {
        Alert.alert(
          'Low Storage Space',
          `You need at least ${requiredSpace.toFixed(1)}GB free space to download the ${localModelName} model.`
        );
        return;
      }
    } catch (err) {
      console.warn('Failed to verify free space:', err);
    }

    const downloadModel = async () => {
      isCancelledRef.current = false;
      const modelDir = `${FileSystem.documentDirectory}models/`;
      const modelUri = `${modelDir}${selectedModel.filename}`;

      try {
        const dirInfo = await FileSystem.getInfoAsync(modelDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
        }

        setLocalModelDownloadProgress(0);

        const downloadResumable = FileSystem.createDownloadResumable(
          selectedModel.downloadUrl,
          modelUri,
          { headers: { Accept: 'application/octet-stream' } },
          (downloadProgress) => {
            const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
            if (!isMounted.current || totalBytesExpectedToWrite <= 0) return;
            const progress = Math.min(
              100,
              Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
            );
            setLocalModelDownloadProgress(progress);
          }
        );
        downloadResumableRef.current = downloadResumable;

        const result = await downloadResumable.downloadAsync();
        downloadResumableRef.current = null;

        // CodeReview #234: user-cancelled — skip success handling AND the
        // 'Download Failed' alert; progress already reset by handleCancelDownload.
        if (isCancelledRef.current) {
          isCancelledRef.current = false;
          if (isMounted.current) {
            setLocalModelDownloadProgress(null);
          }
          return;
        }

        if (result && result.status === 200) {
          const info = await FileSystem.getInfoAsync(modelUri);
          const bytes = info.exists && 'size' in info ? (info.size as number) : 0;
          const MIN_MODEL_BYTES = 10 * 1024 * 1024;
          if (bytes < MIN_MODEL_BYTES) {
            await FileSystem.deleteAsync(modelUri, { idempotent: true });
            throw new Error(
              `The server returned ${bytes} bytes instead of a model file. The repository may require authentication.`
            );
          }

          await AsyncStorage.setItem(localModelStorageKey(localModelName), 'true');
          await AsyncStorage.setItem(`${localModelStorageKey(localModelName)}_path`, modelUri);

          if (isMounted.current) {
            setDownloadedModels((prev) => ({ ...prev, [localModelName]: true }));
            setLocalModelDownloadProgress(null);
          }
          Alert.alert('Download Complete', `${localModelName} model downloaded and ready for offline inference.`);
        } else {
          const status = result?.status ?? 'unknown';
          const reason =
            status === 401 || status === 403
              ? 'the model repository requires authentication or accepting a license'
              : status === 404
              ? 'the model file no longer exists at that URL'
              : `the server responded with status ${status}`;
          throw new Error(`Download refused because ${reason}.`);
        }
      } catch (downloadError: any) {
        console.error('[handleDownloadModel] Download failed:', downloadError);
        downloadResumableRef.current = null;
        // CodeReview #234: pauseAsync/abort during cancel rejects here — not a
        // real failure, so reset progress silently without the alert.
        if (isCancelledRef.current) {
          isCancelledRef.current = false;
          if (isMounted.current) {
            setLocalModelDownloadProgress(null);
          }
          return;
        }
        try {
          const partial = await FileSystem.getInfoAsync(modelUri);
          if (partial.exists) {
            await FileSystem.deleteAsync(modelUri, { idempotent: true });
          }
        } catch (cleanupError) {
          console.warn('[handleDownloadModel] Failed to clean up partial file:', cleanupError);
        }
        if (isMounted.current) {
          setLocalModelDownloadProgress(null);
        }
        Alert.alert(
          'Download Failed',
          `Failed to download ${localModelName}: ${downloadError.message || 'Network error'}. Please check your connection and try again.`
        );
      }
    };

    if (wifiOnlyDownload) {
      Alert.alert(
        'Confirm Cellular Download',
        `You are on a cellular connection. Continuing will download ${selectedModel.size} (${selectedModel.filename}). Proceed?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Download', onPress: downloadModel },
        ]
      );
    } else {
      await downloadModel();
    }
  };

  // Spec #174 cancel flow: pause the resumable, delete the partial file, reset progress.
  const handleCancelDownload = async () => {
    isCancelledRef.current = true;
    const resumable = downloadResumableRef.current;
    if (resumable) {
      try {
        await resumable.pauseAsync();
      } catch {
        // Ignore pause failure during cancel (mirrors cancelCustomModelDownload).
      }
      downloadResumableRef.current = null;
    }
    try {
      const selectedModel = LOCAL_MODELS.find((m) => m.name === localModelName);
      if (selectedModel) {
        const modelUri = `${FileSystem.documentDirectory}models/${selectedModel.filename}`;
        const partial = await FileSystem.getInfoAsync(modelUri);
        if (partial.exists) {
          await FileSystem.deleteAsync(modelUri, { idempotent: true });
        }
      }
    } catch (err) {
      console.warn('[handleCancelDownload] Failed to clean up partial file:', err);
    }
    if (isMounted.current) {
      setLocalModelDownloadProgress(null);
    }
  };

  const handleDeleteModel = () => {
    Alert.alert(
      'Delete Model',
      `Are you sure you want to delete the downloaded ${localModelName} model file?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const selectedModel = LOCAL_MODELS.find((m) => m.name === localModelName);
              if (selectedModel) {
                const modelUri = `${FileSystem.documentDirectory}models/${selectedModel.filename}`;
                const fileInfo = await FileSystem.getInfoAsync(modelUri);
                if (fileInfo.exists) {
                  await FileSystem.deleteAsync(modelUri);
                }
              }
              await AsyncStorage.removeItem(localModelStorageKey(localModelName));
              await AsyncStorage.removeItem(`${localModelStorageKey(localModelName)}_path`);
            } catch (err) {
              console.warn('[handleDeleteModel] Failed to delete model file:', err);
            }
            if (isMounted.current) {
              setDownloadedModels((prev) => ({ ...prev, [localModelName]: false }));
            }
            Alert.alert('Model Deleted', `${localModelName} has been removed from storage.`);
            if (isLocalMode) {
              const fallback = useConfigStore.getState().cloudApiKeys?.[useConfigStore.getState().activeCloudProvider || 'gemini']
                ? 'cloud'
                : 'server';
              setConnectionMode(fallback);
            }
          },
        },
      ]
    );
  };

  const handleExportModel = async () => {
    const selectedModel = LOCAL_MODELS.find((m) => m.name === localModelName);
    if (!selectedModel) {
      Alert.alert('Error', 'Selected model not found.');
      return;
    }

    const modelDir = `${FileSystem.documentDirectory}models/`;
    const modelUri = `${modelDir}${selectedModel.filename}`;

    try {
      const fileInfo = await FileSystem.getInfoAsync(modelUri);
      if (!fileInfo.exists) {
        Alert.alert('File Not Found', 'The model file could not be found in internal storage.');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Export Not Supported', 'Sharing is not available on this device.');
        return;
      }

      await Sharing.shareAsync(modelUri, {
        dialogTitle: `Export ${selectedModel.name}`,
        mimeType: 'application/octet-stream',
      });
    } catch (err: any) {
      console.error('Export failed:', err);
      Alert.alert('Export Failed', err?.message || 'Failed to export model.');
    }
  };

  const handleImportModel = async () => {
    if (isLocalLlmDown) {
      Alert.alert('Local Model Down', 'The local LLM is currently down/unavailable.');
      return;
    }

    const selectedModel = LOCAL_MODELS.find((m) => m.name === localModelName);
    if (!selectedModel) {
      Alert.alert('Error', 'Selected model not found.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const pickedUri = asset.uri;
      const pickedName = asset.name;

      const isValidExtension = pickedName.toLowerCase().endsWith(`.${selectedModel.format}`);

      if (!isValidExtension) {
        Alert.alert(
          'Invalid File Format',
          `The selected file "${pickedName}" does not match the expected format for "${selectedModel.name}" (needs to be a .${selectedModel.format} file).`
        );
        return;
      }

      if (pickedName.toLowerCase() !== selectedModel.filename.toLowerCase()) {
        Alert.alert(
          'Filename Mismatch',
          `The file is named "${pickedName}", but the app expects "${selectedModel.filename}". The file will be imported and renamed to match the expected name to prevent configuration errors. Proceed?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Import',
              onPress: () => copyAndSaveImport(pickedUri, selectedModel),
            },
          ]
        );
      } else {
        await copyAndSaveImport(pickedUri, selectedModel);
      }
    } catch (err: any) {
      console.error('Import failed:', err);
      Alert.alert('Import Failed', err?.message || 'Failed to import model.');
    }
  };

  const copyAndSaveImport = async (pickedUri: string, selectedModel: typeof LOCAL_MODELS[0]) => {
    const modelDir = `${FileSystem.documentDirectory}models/`;
    const modelUri = `${modelDir}${selectedModel.filename}`;

    try {
      setModelBusy(true);

      const dirInfo = await FileSystem.getInfoAsync(modelDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
      }

      await FileSystem.copyAsync({
        from: pickedUri,
        to: modelUri,
      });

      const fileInfo = await FileSystem.getInfoAsync(modelUri);
      if (!fileInfo.exists) {
        throw new Error('Copied file could not be verified on disk.');
      }

      await AsyncStorage.setItem(localModelStorageKey(selectedModel.name), 'true');
      await AsyncStorage.setItem(`${localModelStorageKey(selectedModel.name)}_path`, modelUri);

      if (isMounted.current) {
        setDownloadedModels((prev) => ({ ...prev, [selectedModel.name]: true }));
      }

      Alert.alert('Import Complete', `"${selectedModel.name}" has been successfully imported and is ready to use!`);
    } catch (err: any) {
      console.error('Copy failed:', err);
      Alert.alert('Import Failed', `Failed to copy model file: ${err.message}`);
    } finally {
      if (isMounted.current) {
        setModelBusy(false);
      }
    }
  };

  return {
    downloadedModels,
    modelBusy,
    isActiveModelDownloaded,
    isActiveModelLoaded,
    handleLoadIntoRam,
    handleUnloadFromRam,
    handleDownloadModel,
    handleCancelDownload,
    handleDeleteModel,
    handleExportModel,
    handleImportModel,
  };
}

export default useModelDownload;
