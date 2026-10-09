import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { useConfigStore } from '../../store/useConfigStore';
import {
  localModelStorageKey,
  LOCAL_MODELS,
} from '../../utils/localLlm';
import {
  detectRamBytes,
  getModelStatusForRam,
  getOptimalSettingsForRam,
  getDynamicModelStatusForRam,
  detectGpuVendor,
  getGpuBackendPreference,
  type GpuVendor,
} from '../../utils/ramDetection';
import {
  getCustomModels,
  deleteCustomModel,
  importModelFromFile,
  startCustomModelDownload,
  pauseCustomModelDownload,
  resumeCustomModelDownload,
  preflightUrlMagicBytes,
  CustomModelRecord,
  CustomModelDownloadProgress,
  SupportedModelFormat,
  NeedleVariant,
} from '../../utils/customModelStorage';
import { useModelDownload } from '../../hooks/useModelDownload';
import {
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  PrimaryButton,
  DangerButton,
  useAurora,
} from '../../components/ui/settingsKit';
import NeedleModule from '../../modules/needle';

const MODE_OPTIONS = [
  { value: 'cloud' as const, label: '☁️ Cloud' },
  { value: 'local' as const, label: '📱 Local' },
];

const NETWORK_OPTIONS = [
  { value: 'wifi' as const, label: 'Wi-Fi Only' },
  { value: 'any' as const, label: 'Any Network' },
];

const GPU_BACKEND_OPTIONS = [
  { value: 'auto' as const, label: 'Auto' },
  { value: 'opencl' as const, label: 'OpenCL' },
  { value: 'vulkan' as const, label: 'Vulkan' },
  { value: 'cpu' as const, label: 'CPU' },
];

const GPU_QUANT_OPTIONS = [
  { value: 'auto' as const, label: 'Auto' },
  { value: 'q4_0' as const, label: 'Q4_0' },
  { value: 'q4_k_m' as const, label: 'Q4_K_M' },
  { value: 'q8_0' as const, label: 'Q8_0' },
];

/**
 * Wayfinder #173 Audit — Local AI Rows
 * Model rows: LOCAL_MODELS filtered by getModelStatusForRam (recommended/borderline/unsupported) — filtered when showUnsupportedModels=false.
 * Needle rows (format cact: Needle-2 45M, Needle-3 (20-layer)) are 'recommended' on <4.5GB and 4.5-7.5GB tiers (ramDetection.ts), so they are
 * never hidden when showUnsupportedModels=false — no duplicated tier logic here, just the shared helper.
 * Download state: useConfigStore localModelDownloadProgress nullable; isDownloading = progress!==null; isActiveDownloading = isSelected && progress!==null.
 * Progress lives inline under filename when isActiveDownloading (View h8 radius4 bg rgba(255,255,255,0.08) + fill aurora.acc1 width `${progress}%`) plus global Card fallback when isDownloading.
 * Spec #174: per-row inline bar + 'Downloading {name} {progress}%' textMuted sub-1 600 + right-aligned '{progress}%' aurora.acc1 700; row Pressable minHeight 48, accessibilityLabel 'Downloading {model} {progress}%' vs '{name} {status}, Downloaded/Not downloaded', no native ProgressBar, 48dp targets, AA contrast.
 * Cancel: inline 'Cancel download {name}' Pressable + global Card Cancel button; pauseAsync + delete partial + progress null (mirrors cancelCustomModelDownload). Delete: confirm Alert + remove file/keys (DangerButton).
 * Wayfinder #230 — Needle engine pill: NeedleModule.hasNativeLibrary() true → 'Accelerated' (#10b981), false → 'Mock Fallback' (#fb923c) block-with-warning, never silent mock.
 */
export default function LocalAiScreen() {
  const connectionMode = useConfigStore((s) => s.connectionMode);
  const setConnectionMode = useConfigStore((s) => s.setConnectionMode);
  const isLocalMode = connectionMode === 'local';
  const localModelName = useConfigStore((s) => s.localModelName);
  const setLocalModelName = useConfigStore((s) => s.setLocalModelName);
  const localModelDownloadProgress = useConfigStore((s) => s.localModelDownloadProgress);
  const setLocalModelDownloadProgress = useConfigStore((s) => s.setLocalModelDownloadProgress);
  const wifiOnlyDownload = useConfigStore((s) => s.wifiOnlyDownload);
  const setWifiOnlyDownload = useConfigStore((s) => s.setWifiOnlyDownload);

  const { colors, sizes, aurora } = useAurora();
  const isMounted = useRef(true);

  const detectedRamBytes = useConfigStore((s) => s.detectedRamBytes);
  const setDetectedRamBytes = useConfigStore((s) => s.setDetectedRamBytes);
  const localConfigAutoApplied = useConfigStore((s) => s.localConfigAutoApplied);
  const setLocalConfigAutoApplied = useConfigStore((s) => s.setLocalConfigAutoApplied);
  const localContextSize = useConfigStore((s) => s.localContextSize);
  const setLocalContextSize = useConfigStore((s) => s.setLocalContextSize);
  const localMaxTokens = useConfigStore((s) => s.localMaxTokens);
  const setLocalMaxTokens = useConfigStore((s) => s.setLocalMaxTokens);
  const gpuBackendPreference = useConfigStore((s) => s.gpuBackendPreference);
  const setGpuBackendPreference = useConfigStore((s) => s.setGpuBackendPreference);
  const gpuQuantPreference = useConfigStore((s) => s.gpuQuantPreference);
  const setGpuQuantPreference = useConfigStore((s) => s.setGpuQuantPreference);

  const [showUnsupportedModels, setShowUnsupportedModels] = useState(false);
  const [detectedGpuVendor, setDetectedGpuVendor] = useState<GpuVendor | null>(null);

  // Wayfinder #230: Needle engine runtime state. Synchronous boolean, safe on
  // web/Jest where the native module is absent (hasNativeLibrary() → false).
  const [needleHasNative] = useState(() => {
    try {
      return NeedleModule.hasNativeLibrary();
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (detectedRamBytes === null) {
      detectRamBytes().then((bytes) => {
        if (isMounted.current) {
          setDetectedRamBytes(bytes);
        }
      });
    }
  }, [detectedRamBytes, setDetectedRamBytes]);

  useEffect(() => {
    detectGpuVendor().then((vendor) => {
      if (isMounted.current) {
        setDetectedGpuVendor(vendor);
      }
    });
  }, []);

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
  const [customModels, setCustomModels] = useState<CustomModelRecord[]>([]);
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);
  const [customTab, setCustomTab] = useState<'url' | 'file'>('url');
  const [customModelName, setCustomModelName] = useState('');
  const [customModelUrl, setCustomModelUrl] = useState('');
  const [customFormat, setCustomFormat] = useState<SupportedModelFormat>('cact');
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [preflightResult, setPreflightResult] = useState<{
    valid: boolean;
    format: SupportedModelFormat | null;
    variant?: NeedleVariant | null;
    contentLength?: number;
    error?: string;
  } | null>(null);
  const [customDownloadProgress, setCustomDownloadProgress] = useState<CustomModelDownloadProgress | null>(null);

  const loadCustomModelsList = async () => {
    try {
      const list = await getCustomModels();
      if (isMounted.current) {
        setCustomModels(list);
      }
    } catch (e) {
      console.warn('[local-ai] Failed to load custom models:', e);
    }
  };

  useEffect(() => {
    loadCustomModelsList();
  }, []);

  const handleSelectCustomModel = async (model: CustomModelRecord) => {
    const ram = detectedRamBytes || 6 * 1024 * 1024 * 1024;
    const status = getDynamicModelStatusForRam(model.sizeBytes, model.format, ram);
    const selectAction = async () => {
      setLocalModelName(model.name);
      await AsyncStorage.setItem(localModelStorageKey(model.name), 'true');
      await AsyncStorage.setItem(`${localModelStorageKey(model.name)}_path`, model.localUri);
    };

    if (status === 'borderline') {
      Alert.alert(
        'Borderline Memory',
        'Warning: This custom model requires more memory than recommended and may run slowly.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Select', onPress: selectAction },
        ]
      );
    } else if (status === 'unsupported') {
      Alert.alert(
        'High OOM Risk',
        'Warning: This custom model requires significantly more RAM than your device has. Do you want to select it anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Select Anyway', onPress: selectAction },
        ]
      );
    } else {
      await selectAction();
    }
  };

  const handleDeleteCustomModel = (model: CustomModelRecord) => {
    Alert.alert(
      'Delete Model',
      `Are you sure you want to delete ${model.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCustomModel(model.id);
            if (localModelName === model.name) {
              setLocalModelName('Qwen2.5 0.5B');
            }
            await loadCustomModelsList();
          },
        },
      ]
    );
  };

  const handlePreflightUrl = async () => {
    if (!customModelUrl) {
      Alert.alert('Error', 'Please enter a model URL');
      return;
    }
    setIsPreflighting(true);
    setPreflightResult(null);
    try {
      const res = await preflightUrlMagicBytes(customModelUrl);
      setPreflightResult(res);
      if (res.format) {
        setCustomFormat(res.format);
      }
    } catch (err: any) {
      setPreflightResult({ valid: false, format: null, variant: null, error: err?.message });
    } finally {
      setIsPreflighting(false);
    }
  };

  const handleStartCustomDownload = async () => {
    if (!customModelUrl || !customModelName) {
      Alert.alert('Error', 'Please enter model name and URL');
      return;
    }
    try {
      const modelId = `custom_${Date.now()}`;
      await startCustomModelDownload(
        {
          id: modelId,
          name: customModelName,
          url: customModelUrl,
          format: customFormat,
        },
        (progress: CustomModelDownloadProgress) => {
          if (isMounted.current) {
            setCustomDownloadProgress(progress);
          }
        }
      );
      Alert.alert('Success', `Model ${customModelName} downloaded successfully!`);
      setShowAddCustomModal(false);
      setCustomModelName('');
      setCustomModelUrl('');
      setPreflightResult(null);
      setCustomDownloadProgress(null);
      await loadCustomModelsList();
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Unknown download error');
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const record = await importModelFromFile(asset.uri, asset.name);
      Alert.alert('Import Complete', `Imported ${record.name} (${record.format.toUpperCase()})`);
      setShowAddCustomModal(false);
      await loadCustomModelsList();
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'Failed to import model file');
    }
  };
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const {
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
  } = useModelDownload({ customModels, needleHasNative, isMounted });

  const isDownloading = localModelDownloadProgress !== null;

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
          onChange={(v) => {
            if (v === 'local') {
              setConnectionMode('local');
            } else {
              const hasCloud = Boolean(
                useConfigStore.getState().cloudApiKeys?.[useConfigStore.getState().activeCloudProvider || 'gemini']
              );
              setConnectionMode(hasCloud ? 'cloud' : 'server');
            }
          }}
        />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16 }}>
          Local mode uses {localModelName || 'the selected model'} entirely on-device. A mock fallback is always labeled as a mock.
        </Text>
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 8,
            backgroundColor: 'rgba(0,0,0,0.3)',
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: needleHasNative ? '#10b981' : '#fb923c',
          }}
          accessibilityRole="text"
          accessibilityLabel={needleHasNative ? 'Needle Engine Accelerated' : 'Needle Engine Mock fallback'}
        >
          <Text style={{ color: needleHasNative ? '#10b981' : '#fb923c', fontSize: sizes.sub - 1, fontWeight: '700' }}>
            {needleHasNative ? '⚡ Needle Engine: Accelerated (native)' : '⚠️ Needle Engine: Mock fallback — on-device blocked'}
          </Text>
        </View>
        {!needleHasNative ? (
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16, marginTop: 6 }}>
            Native Needle library not detected in this build. Loading a Needle model (.cact) is blocked with a warning — mock output is never served silently.
          </Text>
        ) : null}
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
                  {model.format === 'cact' ? (
                    <View
                      style={{ backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: needleHasNative ? '#10b981' : '#fb923c' }}
                      accessibilityRole="text"
                      accessibilityLabel={needleHasNative ? 'Needle Engine Accelerated' : 'Needle Engine Mock fallback'}
                    >
                      <Text style={{ color: needleHasNative ? '#10b981' : '#fb923c', fontSize: sizes.sub - 2, fontWeight: '700' }}>
                        {needleHasNative ? 'Accelerated' : 'Mock Fallback'}
                      </Text>
                    </View>
                  ) : null}
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
                {model.format === 'cact' && !needleHasNative ? (
                  <Text style={{ color: '#fb923c', fontSize: sizes.sub - 1, marginTop: 4, fontWeight: '600' }}>
                    Mock fallback active — loading is blocked until the native library is packaged.
                  </Text>
                ) : null}
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
                    <Pressable
                      onPress={handleCancelDownload}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel download ${model.name}`}
                      style={{
                        alignSelf: 'flex-start',
                        backgroundColor: 'rgba(239,68,68,0.15)',
                        borderColor: 'rgba(239,68,68,0.4)',
                        borderWidth: 1,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 6,
                        marginTop: 4,
                      }}
                    >
                      <Text style={{ color: '#f87171', fontSize: sizes.sub - 1, fontWeight: '700' }}>
                        Cancel Download
                      </Text>
                    </Pressable>
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Label>Custom Models (.cact, .gguf, .task)</Label>
          <Pressable
            style={{ backgroundColor: aurora.acc1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
            onPress={() => setShowAddCustomModal(true)}
          >
            <Text style={{ color: '#fff', fontSize: sizes.sub, fontWeight: '700' }}>+ Add Custom Model</Text>
          </Pressable>
        </View>

        {customModels.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub, fontStyle: 'italic', marginVertical: 8 }}>
            No custom models installed yet. Tap above to import via URL or file.
          </Text>
        ) : (
          customModels.map((m) => {
            const isSelected = localModelName === m.name;
            const ram = detectedRamBytes || 6 * 1024 * 1024 * 1024;
            const status = getDynamicModelStatusForRam(m.sizeBytes, m.format, ram);
            const statusBg =
              status === 'recommended'
                ? '#10b981'
                : status === 'borderline'
                ? '#f59e0b'
                : '#ef4444';

            return (
              <View
                key={m.id}
                style={[
                  styles.modelRow,
                  {
                    borderColor: isSelected ? aurora.acc1 : colors.glassBorder,
                    backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent',
                    marginBottom: 8,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>{m.name}</Text>
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700' }}>{m.format.toUpperCase()}</Text>
                    </View>
                    <View style={{ backgroundColor: statusBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'capitalize' }}>{status}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 2 }}>
                    {(m.sizeBytes / (1024 * 1024)).toFixed(1)} MB • {m.source === 'url' ? 'URL Download' : 'File Import'}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {!isSelected ? (
                    <Pressable
                      style={{ backgroundColor: aurora.acc1, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 }}
                      onPress={() => handleSelectCustomModel(m)}
                    >
                      <Text style={{ color: '#fff', fontSize: sizes.sub - 1, fontWeight: '600' }}>Select</Text>
                    </Pressable>
                  ) : (
                    <View style={{ backgroundColor: 'rgba(16,185,129,0.2)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 }}>
                      <Text style={{ color: '#10b981', fontSize: sizes.sub - 1, fontWeight: '700' }}>Active</Text>
                    </View>
                  )}
                  <Pressable
                    style={{ backgroundColor: 'rgba(239,68,68,0.2)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 }}
                    onPress={() => handleDeleteCustomModel(m)}
                  >
                    <Text style={{ color: '#ef4444', fontSize: sizes.sub - 1, fontWeight: '600' }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
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
        <Label>GPU Acceleration & Backend</Label>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255,255,255,0.06)',
            marginBottom: 10,
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>Detected Hardware</Text>
          <View
            style={{
              backgroundColor: 'rgba(0,0,0,0.3)',
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: detectedGpuVendor && detectedGpuVendor !== 'unknown' ? '#10b981' : '#fb923c',
            }}
            accessibilityRole="text"
            accessibilityLabel={
              detectedGpuVendor && detectedGpuVendor !== 'unknown'
                ? `Detected GPU: ${detectedGpuVendor}`
                : 'Unknown GPU — using CPU-safe default'
            }
          >
            <Text
              style={{
                color: detectedGpuVendor && detectedGpuVendor !== 'unknown' ? '#10b981' : '#fb923c',
                fontSize: sizes.sub - 1,
                fontWeight: '700',
              }}
            >
              {detectedGpuVendor === null
                ? 'Detecting GPU…'
                : detectedGpuVendor === 'unknown'
                ? 'Unknown GPU — using CPU-safe default'
                : detectedGpuVendor === 'adreno'
                ? 'Adreno → OpenCL'
                : detectedGpuVendor === 'mali'
                ? 'Mali → Vulkan'
                : detectedGpuVendor === 'xclipse'
                ? 'Xclipse → Vulkan'
                : 'Google Tensor → CPU (Gemma guard)'}
            </Text>
          </View>
        </View>

        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16, marginBottom: 8 }}>
          {detectedGpuVendor === 'tensor'
            ? 'Tensor chip detected: Gemma Q4_K_M is guarded to CPU to avoid driver kernel faults. Other models map to safe CPU execution.'
            : detectedGpuVendor === 'unknown'
            ? 'GPU vendor could not be confirmed natively. Vela defaults safely to CPU to avoid driver faults.'
            : `PrivateLM target preference: ${getGpuBackendPreference(
                detectedGpuVendor ?? 'unknown',
                gpuBackendPreference,
                localModelName
              ).toUpperCase()} (engine integration pending).`}
        </Text>

        <View style={{ marginTop: 6, marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontSize: sizes.sub, fontWeight: '600', marginBottom: 6 }}>
            Backend Preference (Override)
          </Text>
          <PillGroup
            options={GPU_BACKEND_OPTIONS}
            value={gpuBackendPreference}
            onChange={(v) => setGpuBackendPreference(v)}
          />
        </View>

        <View style={{ marginTop: 2 }}>
          <Text style={{ color: colors.text, fontSize: sizes.sub, fontWeight: '600', marginBottom: 6 }}>
            Quantization Preference
          </Text>
          <PillGroup
            options={GPU_QUANT_OPTIONS}
            value={gpuQuantPreference}
            onChange={(v) => setGpuQuantPreference(v)}
          />
        </View>

        <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1, marginTop: 10, lineHeight: 14 }}>
          Mock honesty: these preferences are stored and shown here, but no engine consumes them yet — on-device acceleration still depends on compatible native drivers, and nothing here changes how a model currently runs.
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
          <Pressable
            onPress={handleCancelDownload}
            accessibilityRole="button"
            accessibilityLabel={`Cancel download ${localModelName}`}
            style={{
              marginTop: 10,
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              borderWidth: 1,
              borderColor: 'rgba(239, 68, 68, 0.35)',
              borderRadius: 10,
              paddingVertical: 11,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#f87171', fontSize: sizes.text, fontWeight: '600' }}>
              Cancel Download
            </Text>
          </Pressable>
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
      {/* Add Custom Model Modal Sheet */}
      <Modal
        visible={showAddCustomModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddCustomModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#1e1e2d', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: '#fff', fontSize: sizes.title, fontWeight: '700' }}>Add Custom Model</Text>
              <Pressable onPress={() => setShowAddCustomModal(false)}>
                <Text style={{ color: colors.textMuted, fontSize: sizes.title }}>✕</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <Pressable
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  alignItems: 'center',
                  borderRadius: 8,
                  backgroundColor: customTab === 'url' ? aurora.acc1 : 'rgba(255,255,255,0.06)',
                }}
                onPress={() => setCustomTab('url')}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>URL Download</Text>
              </Pressable>
              <Pressable
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  alignItems: 'center',
                  borderRadius: 8,
                  backgroundColor: customTab === 'file' ? aurora.acc1 : 'rgba(255,255,255,0.06)',
                }}
                onPress={() => setCustomTab('file')}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>File Import</Text>
              </Pressable>
            </View>

            {customTab === 'url' ? (
              <ScrollView>
                <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 4 }}>Model Name</Text>
                <TextInput
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    color: '#fff',
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: colors.glassBorder,
                  }}
                  placeholder="e.g. My Needle 45M"
                  placeholderTextColor="#777"
                  value={customModelName}
                  onChangeText={setCustomModelName}
                />

                <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 4 }}>Download URL (.cact, .gguf, .task)</Text>
                <TextInput
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    color: '#fff',
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: colors.glassBorder,
                  }}
                  placeholder="https://huggingface.co/.../model.cact"
                  placeholderTextColor="#777"
                  value={customModelUrl}
                  onChangeText={(val) => {
                    setCustomModelUrl(val);
                    setPreflightResult(null);
                  }}
                />

                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: 10, borderRadius: 8, alignItems: 'center' }}
                    onPress={handlePreflightUrl}
                    disabled={isPreflighting}
                  >
                    {isPreflighting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontWeight: '600' }}>Validate Header</Text>
                    )}
                  </Pressable>
                </View>

                {preflightResult && (
                  <View
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      backgroundColor: preflightResult.valid ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: preflightResult.valid ? '#10b981' : '#ef4444',
                    }}
                  >
                    <Text style={{ color: preflightResult.valid ? '#34d399' : '#f87171', fontWeight: '600' }}>
                      {preflightResult.valid
                        ? `Valid format: ${preflightResult.format?.toUpperCase()}${preflightResult.variant ? ` · ${preflightResult.variant}` : ''} (${preflightResult.contentLength ? (preflightResult.contentLength / (1024 * 1024)).toFixed(1) + ' MB' : 'Size unknown'})`
                        : `Validation error: ${preflightResult.error || 'Invalid magic bytes'}`}
                    </Text>
                  </View>
                )}

                {customDownloadProgress && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: '#fff', fontSize: sizes.sub, marginBottom: 4 }}>
                      Downloading: {Math.round(customDownloadProgress.progressFraction * 100)}%
                    </Text>
                    <View style={styles.progressBg}>
                      <View style={[styles.progressFill, { width: `${Math.round(customDownloadProgress.progressFraction * 100)}%`, backgroundColor: aurora.acc1 }]} />
                    </View>
                  </View>
                )}

                <PrimaryButton
                  label="Start Resumable Download"
                  onPress={handleStartCustomDownload}
                />
              </ScrollView>
            ) : (
              <View style={{ paddingVertical: 20 }}>
                <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 16 }}>
                  Select a local .cact, .gguf, or .task model file from your device storage to import into Vela.
                </Text>
                <PrimaryButton
                  label="📁 Select File from Device"
                  onPress={handlePickDocument}
                />
              </View>
            )}
          </View>
        </View>
      </Modal>
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
