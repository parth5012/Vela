import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
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
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  PrimaryButton,
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
      await initializeLocalModel();
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

  return (
    <AuroraScreen
      title="Local AI"
      subtitle="Run Vela on-device with a LiteRT or GGUF model, or fall back to your cloud backend. Manage RAM with Load/Unload."
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

      <Card>
        <Label>Model</Label>
        {LOCAL_MODELS.map((model) => {
          const isSelected = localModelName === model.name;
          const isDownloaded = downloadedModels[model.name];
          return (
            <Pressable
              key={model.name}
              onPress={() => setLocalModelName(model.name)}
              disabled={isDownloading}
              style={[
                styles.modelRow,
                { borderColor: isSelected ? aurora.acc1 : colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                isDownloading && { opacity: 0.6 },
              ]}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                  {model.name}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginTop: 2 }}>
                  {model.size} · {model.description}
                </Text>
                <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1, marginTop: 2, fontFamily: 'monospace' }}>
                  {model.filename}
                </Text>
              </View>
              <Text style={{ color: isDownloaded ? '#34d399' : colors.textDark, fontSize: sizes.sub, fontWeight: '600' }}>
                {isDownloaded ? '✓ Downloaded' : 'Not downloaded'}
              </Text>
            </Pressable>
          );
        })}
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

      <PrimaryButton
        label={isActiveModelDownloaded ? `Delete ${localModelName}` : `Download ${localModelName}`}
        onPress={isActiveModelDownloaded ? handleDeleteModel : handleDownloadModel}
        disabled={isDownloading}
      />
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
