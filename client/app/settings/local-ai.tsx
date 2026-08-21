import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useConfigStore } from '../../store/useConfigStore';
import {
  isLocalLlmDown,
  localModelStorageKey,
  LOCAL_MODELS,
  getLoadedModelName,
  subscribeLocalModelLoadedState,
  initializeLocalModel,
  unloadLocalModel,
} from '../../utils/localLlm';
import {
  detectRamBytes,
  getModelStatusForRam,
  getOptimalSettingsForRam
} from '../../utils/ramDetection';
import {
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  PrimaryButton,
  DangerButton,
  useAurora,
} from '../../components/ui/settingsKit';

const MODE_OPTIONS = [
  { value: 'cloud' as const, label: '☁️ Cloud' },
  { value: 'local' as const, label: '📱 Local' },
];

const NETWORK_OPTIONS = [
  { value: 'wifi' as const, label: 'Wi-Fi Only' },
  { value: 'any' as const, label: 'Any Network' },
];

/**
 * Wayfinder #173 Audit — Local AI Rows
 * Model rows: LOCAL_MODELS filtered by getModelStatusForRam (recommended/borderline/unsupported) — filtered when showUnsupportedModels=false.
 * Download state: useConfigStore localModelDownloadProgress nullable; isDownloading = progress!==null; isActiveDownloading = isSelected && progress!==null.
 * Progress lives inline under filename when isActiveDownloading (View h8 radius4 bg rgba(255,255,255,0.08) + fill aurora.acc1 width `${progress}%`) plus global Card fallback when isDownloading.
 * Spec #174: per-row inline bar + 'Downloading {name} {progress}%' textMuted sub-1 600 + right-aligned '{progress}%' aurora.acc1 700; row Pressable minHeight 48, accessibilityLabel 'Downloading {model} {progress}%' vs '{name} {status}, Downloaded/Not downloaded', no native ProgressBar, 48dp targets, AA contrast.
 */
export default function LocalAiScreen() {
  const isLocalMode = useConfigStore((s) => s.isLocalMode);
  const setIsLocalMode = useConfigStore((s) => s.setIsLocalMode);
  const localModelName = useConfigStore((s) => s.localModelName);
  const setLocalModelName = useConfigStore((s) => s.setLocalModelName);
  const localModelDownloadProgress = useConfigStore((s) => s.localModelDownloadProgress);
  const setLocalModelDownloadProgress = useConfigStore((s) => s.setLocalModelDownloadProgress);
  const wifiOnlyDownload = useConfigStore((s) => s.wifiOnlyDownload);
  const setWifiOnlyDownload = useConfigStore((s) => s.setWifiOnlyDownload);

  const { colors, sizes, aurora } = useAurora();
  const isMounted = useRef(true);
  const [downloadedModels, setDownloadedModels] = useState<Record<string, boolean>>({});

  const detectedRamBytes = useConfigStore((s) => s.detectedRamBytes);
  const setDetectedRamBytes = useConfigStore((s) => s.setDetectedRamBytes);
  const localConfigAutoApplied = useConfigStore((s) => s.localConfigAutoApplied);
  const setLocalConfigAutoApplied = useConfigStore((s) => s.setLocalConfigAutoApplied);
  const localContextSize = useConfigStore((s) => s.localContextSize);
  const setLocalContextSize = useConfigStore((s) => s.setLocalContextSize);
  const localMaxTokens = useConfigStore((s) => s.localMaxTokens);
  const setLocalMaxTokens = useConfigStore((s) => s.setLocalMaxTokens);

  const [showUnsupportedModels, setShowUnsupportedModels] = useState(false);

  useEffect(() => {
    if (detectedRamBytes === null) {
      detectRamBytes().then((bytes) => {
        if (isMounted.current) {
          setDetectedRamBytes(bytes);
        }
      });
    }
  }, [detectedRamBytes]);

  const handleApplyRecommendation = () => {
    if (detectedRamBytes) {
      const rec = getOptimalSettingsForRam(detectedRamBytes);
      setLocalModelName(rec.modelName);
      setLocalContextSize(rec.contextSize);
      setLocalMaxTokens(rec.maxTokens);
      setLocalConfigAutoApplied(true);
      Alert.alert('Recommendation Applied', `Recommended settings applied successfully.`);
    }
  };

  const handleSelectModel = (modelName: string) => {
    const ram = detectedRamBytes || 6 * 1024 * 1024 * 1024;
    const status = getModelStatusForRam(modelName, ram);
    if (status === 'borderline') {
      Alert.alert(
        'Borderline Model',
        'Warning: This model requires more memory than recommended for your device and may run slowly.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Select', onPress: () => setLocalModelName(modelName) }
        ]
      );
    } else if (status === 'unsupported') {
      Alert.alert(
        'High OOM Risk',
        'Warning: High OOM Risk. This model requires significantly more RAM than your device has. It is likely to crash. Do you want to select it anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Select Anyway', onPress: () => setLocalModelName(modelName) }
        ]
      );
    } else {
      setLocalModelName(modelName);
    }
  };
  const [loadedModelName, setLoadedModelName] = useState<string | null>(getLoadedModelName());
  const [modelBusy, setModelBusy] = useState(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Keep the "loaded in RAM" badge in sync with the engine's actual state.
  useEffect(() => {
    const unsubscribe = subscribeLocalModelLoadedState(() => {
      if (isMounted.current) {
        setLoadedModelName(getLoadedModelName());
      }
    });
    setLoadedModelName(getLoadedModelName());
    return unsubscribe;
  }, []);

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
  }, [localModelName]);

  const isDownloading = localModelDownloadProgress !== null;
  const isActiveModelDownloaded = !!downloadedModels[localModelName];
  const isActiveModelLoaded = loadedModelName === localModelName;

  const handleLoadIntoRam = async () => {
    if (isLocalLlmDown) {
      Alert.alert('Local Model Down', 'The local LLM is currently down/unavailable.');
      return;
    }
    if (!isActiveModelDownloaded) {
      Alert.alert('Not Downloaded', `Download ${localModelName} first before loading it into RAM.`);
      return;
    }
    if (modelBusy) return;
    setModelBusy(true);
    try {
      await initializeLocalModel(true);;
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

        const result = await downloadResumable.downloadAsync();

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
              setIsLocalMode(false);
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

      const isTask = selectedModel.format === 'task';
      const isValidExtension = isTask
        ? pickedName.toLowerCase().endsWith('.task')
        : pickedName.toLowerCase().endsWith('.gguf');

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

  return (
    <AuroraScreen
      title="Local AI"
      subtitle="Run Vela on-device GGUF models (via llama.cpp), or fall back to your cloud backend. Manage RAM with Load/Unload."
    >
      <Card>
        <Label>Engine</Label>
        <PillGroup
          options={MODE_OPTIONS}
          value={isLocalMode ? 'local' : 'cloud'}
          onChange={(v) => setIsLocalMode(v === 'local')}
        />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16 }}>
          Local mode uses {localModelName || 'the selected model'} entirely on-device. A mock fallback is always labeled as a mock.
        </Text>
      </Card>

      {detectedRamBytes !== null && !localConfigAutoApplied && (
        <Card>
          <Label>RAM Auto-Configuration</Label>
          <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600', marginBottom: 4 }}>
            System detected {(detectedRamBytes / (1024 ** 3)).toFixed(1)} GB of physical memory.
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 16, marginBottom: 12 }}>
            Recommended configuration:
            {"\n"}• Model: {getOptimalSettingsForRam(detectedRamBytes).modelName}
            {"\n"}• Context window: {getOptimalSettingsForRam(detectedRamBytes).contextSize} tokens
            {"\n"}• Max outputs: {getOptimalSettingsForRam(detectedRamBytes).maxTokens} tokens
          </Text>
          <PrimaryButton
            label="Apply Recommended Settings"
            onPress={handleApplyRecommendation}
          />
        </Card>
      )}

            <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Label>Model</Label>
          <Pressable
            onPress={() => setShowUnsupportedModels(!showUnsupportedModels)}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderColor: colors.glassBorder,
              borderWidth: 1,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 6
            }}
          >
            <Text style={{ color: showUnsupportedModels ? colors.text : colors.textMuted, fontSize: sizes.sub, fontWeight: '600' }}>
              {showUnsupportedModels ? 'Show Unsupported: ON' : 'Show Unsupported: OFF'}
            </Text>
          </Pressable>
        </View>
        {LOCAL_MODELS.filter((model) => {
          if (showUnsupportedModels) return true;
          const status = getModelStatusForRam(model.name, detectedRamBytes || 6 * 1024 * 1024 * 1024);
          return status !== 'unsupported';
        }).map((model) => {
          const isSelected = localModelName === model.name;
          const isDownloaded = downloadedModels[model.name];
          const status = getModelStatusForRam(model.name, detectedRamBytes || 6 * 1024 * 1024 * 1024);
          const statusColor = status === 'recommended' ? '#10b981' : (status === 'borderline' ? '#fb923c' : '#ef4444');
          const statusText = status.charAt(0).toUpperCase() + status.slice(1);
          const isActiveDownloading = isSelected && localModelDownloadProgress !== null;
          return (
            <Pressable
              key={model.name}
              onPress={() => handleSelectModel(model.name)}
              disabled={isDownloading && !isActiveDownloading}
              accessibilityRole="button"
              accessibilityLabel={
                isActiveDownloading
                  ? `Downloading ${model.name} ${localModelDownloadProgress}%`
                  : `${model.name} ${statusText}, ${isDownloaded ? 'Downloaded' : 'Not downloaded'}`
              }
              accessibilityState={{ selected: isSelected, disabled: isDownloading && !isActiveDownloading }}
              style={[
                styles.modelRow,
                {
                  borderColor: isSelected ? aurora.acc1 : colors.glassBorder,
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  marginBottom: 8,
                  minHeight: 48,
                },
                isDownloading && !isActiveDownloading && { opacity: 0.6 },
              ]}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                    {model.name}
                  </Text>
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: statusColor }}>
                    <Text style={{ color: statusColor, fontSize: sizes.sub - 2, fontWeight: '700' }}>
                      {statusText}
                    </Text>
                  </View>
                </View>
                {model.format === 'task' ? (
                  <Text style={{ color: '#fb923c', fontSize: sizes.sub - 1, fontWeight: 'normal' }}>
                    {'\n'}(Simulated/Mock Only)
                  </Text>
                ) : null}
                <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginTop: 4 }}>
                  {model.size} • {model.description}
                </Text>
                <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1, marginTop: 4, fontFamily: 'monospace' }}>
                  {model.filename}
                </Text>
                {isActiveDownloading ? (
                  <View style={{ marginTop: 10, gap: 4 }}>
                    <View
                      style={{
                        height: 8,
                        borderRadius: 4,
                        overflow: 'hidden',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        borderColor: colors.glassBorder,
                      }}
                      accessibilityLabel={`Downloading ${model.name} ${localModelDownloadProgress}%`}
                    >
                      <View
                        style={{
                          height: '100%',
                          width: `${localModelDownloadProgress ?? 0}%`,
                          backgroundColor: aurora.acc1,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                    <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, fontWeight: '600' }}>
                      Downloading {model.name} {localModelDownloadProgress}% 
                    </Text>
                  </View>
                ) : null}
              </View>
              {isActiveDownloading ? (
                <Text style={{ color: aurora.acc1, fontSize: sizes.sub, fontWeight: '700', marginLeft: 8 }}>
                  {localModelDownloadProgress}%
                </Text>
              ) : (
                <Text style={{ color: isDownloaded ? '#34d399' : colors.textDark, fontSize: sizes.sub, fontWeight: '600' }}>
                  {isDownloaded ? 'Downloaded' : 'Not downloaded'}
                </Text>
              )}
            </Pressable>
          );
        })}
      </Card>

      <Card>
        <Label>Context Limit Settings</Label>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 4 }}>Context Size (Tokens)</Text>
            <TextInput
              style={{
                backgroundColor: 'rgba(0,0,0,0.25)',
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.glassBorder,
                borderRadius: 8,
                padding: 8,
                fontSize: sizes.text
              }}
              keyboardType="numeric"
              value={String(localContextSize || 2048)}
              onChangeText={(val) => {
                const num = parseInt(val, 10);
                if (!isNaN(num)) setLocalContextSize(num);
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 4 }}>Max Output Tokens</Text>
            <TextInput
              style={{
                backgroundColor: 'rgba(0,0,0,0.25)',
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.glassBorder,
                borderRadius: 8,
                padding: 8,
                fontSize: sizes.text
              }}
              keyboardType="numeric"
              value={String(localMaxTokens || 512)}
              onChangeText={(val) => {
                const num = parseInt(val, 10);
                if (!isNaN(num)) setLocalMaxTokens(num);
              }}
            />
          </View>
        </View>
        <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1, marginTop: 6, lineHeight: 14 }}>
          Allocating larger context size uses more memory and can cause model loaded in RAM to OOM crash.
        </Text>
      </Card>

      <Card>
        <Label>Download Network</Label>
        <PillGroup
          options={NETWORK_OPTIONS}
          value={wifiOnlyDownload ? 'wifi' : 'any'}
          onChange={(v) => setWifiOnlyDownload(v === 'wifi')}
        />
      </Card>

      <Card>
        <Label>RAM</Label>
        {detectedRamBytes !== null && (
          <Text style={{ color: colors.text, fontSize: sizes.sub, fontWeight: '700', marginBottom: 6 }}>
            Device RAM: {(detectedRamBytes / (1024 ** 3)).toFixed(1)} GB
          </Text>
        )}
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 16 }}>
          {isActiveModelLoaded
            ? `${localModelName} is loaded in RAM and ready for instant responses.`
            : 'No model loaded in RAM. Load the selected model now, or let the app load it on your first local message.'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!isActiveModelLoaded ? (
            <Pressable
              onPress={handleLoadIntoRam}
              disabled={modelBusy || isDownloading || !isActiveModelDownloaded}
              style={({ pressed }) => [
                styles.ramButton,
                { backgroundColor: aurora.acc1, shadowColor: aurora.acc1, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
                (pressed || modelBusy || isDownloading || !isActiveModelDownloaded) && { opacity: 0.6 },
              ]}
            >
              <Text style={{ color: aurora.onAccent, fontSize: sizes.text, fontWeight: '600' }}>
                {modelBusy ? 'Working…' : `Load ${localModelName} into RAM`}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleUnloadFromRam}
              disabled={modelBusy}
              style={({ pressed }) => [
                styles.ramButton,
                { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.35)' },
                (pressed || modelBusy) && { opacity: 0.6 },
              ]}
            >
              <Text style={{ color: '#f87171', fontSize: sizes.text, fontWeight: '600' }}>
                {modelBusy ? 'Working…' : `Unload ${localModelName} from RAM`}
              </Text>
            </Pressable>
          )}
        </View>
      </Card>

      {isDownloading ? (
        <Card>
          <Label>Downloading {localModelName} — {localModelDownloadProgress}%</Label>
          <View style={[styles.progressBg, { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' }]}>
            <View
              style={[styles.progressFill, { width: `${localModelDownloadProgress ?? 0}%`, backgroundColor: aurora.acc1 }]}
            />
          </View>
        </Card>
      ) : null}

      <View style={{ gap: 8, marginTop: 12 }}>
        {isActiveModelDownloaded ? (
          <>
            <PrimaryButton
              label={`Export ${localModelName}`}
              onPress={handleExportModel}
              disabled={isDownloading}
            />
            <DangerButton
              label={`Delete ${localModelName}`}
              onPress={handleDeleteModel}
            />
          </>
        ) : (
          <>
            <PrimaryButton
              label={`Download ${localModelName}`}
              onPress={handleDownloadModel}
              disabled={isDownloading}
            />
            <Pressable
              onPress={handleImportModel}
              disabled={isDownloading}
              style={({ pressed }) => [
                {
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderColor: colors.glassBorder,
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingVertical: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                (pressed || isDownloading) && { opacity: 0.6 }
              ]}
            >
              <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                Import {localModelName} File
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  progressBg: {
    height: 8,
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  ramButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
