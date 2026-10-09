import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Switch } from 'react-native';
import {
  AuroraScreen,
  Card,
  Field,
  Label,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  ChipGroup,
  useAurora,
} from '../../components/ui/settingsKit';
import {
  useConfigStore,
  ProviderSlug,
  PROVIDER_SLUGS,
  DEFAULT_CLOUD_PROVIDERS,
} from '../../store/useConfigStore';
import {
  fetchProviderModels,
  fetchCustomEndpointModels,
  testProviderConnection,
  trimBearerToken,
  isFreeModelId,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_BASE_URL,
} from '../../utils/providers/models';

interface ProviderMeta {
  name: string;
  description: string;
  icon: string;
  docsUrl: string;
}

const PROVIDER_METAS: Record<ProviderSlug, ProviderMeta> = {
  gemini: {
    name: 'Google Gemini',
    description: 'Direct access to Google Gemini 1.5/2.0 models via AI Studio.',
    icon: '✨',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini, o1, and o3 series models.',
    icon: '⚡',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    name: 'Anthropic Claude',
    description: 'Claude 3.7 Sonnet, Claude 3.5 Haiku, and Opus models.',
    icon: '🧠',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    name: 'OpenRouter',
    description: 'Unified gateway for Llama, DeepSeek, Mistral, and 100+ models.',
    icon: '🌐',
    docsUrl: 'https://openrouter.ai/keys',
  },
  groq: {
    name: 'Groq',
    description: 'Ultra high-speed LPU inference for open source models.',
    icon: '🚀',
    docsUrl: 'https://console.groq.com/keys',
  },
  custom: {
    name: 'Custom (OpenAI-Compatible)',
    description: 'Any self-hosted or proxy endpoint supporting the OpenAI API format.',
    icon: '🛠️',
    docsUrl: '',
  },
};

export default function CloudProvidersScreen() {
  const connectionMode = useConfigStore((s) => s.connectionMode);
  const setConnectionMode = useConfigStore((s) => s.setConnectionMode);
  const activeCloudProvider = useConfigStore((s) => s.activeCloudProvider);
  const setActiveCloudProvider = useConfigStore((s) => s.setActiveCloudProvider);
  const cloudProviders = useConfigStore((s) => s.cloudProviders);
  const setCloudProviderConfig = useConfigStore((s) => s.setCloudProviderConfig);
  const cloudApiKeys = useConfigStore((s) => s.cloudApiKeys);
  const setCloudApiKey = useConfigStore((s) => s.setCloudApiKey);
  const deleteCloudApiKey = useConfigStore((s) => s.deleteCloudApiKey);
  const loadCloudApiKeys = useConfigStore((s) => s.loadCloudApiKeys);

  const { colors, sizes, aurora } = useAurora();
  const isMounted = useRef(true);
  const activeFetchSlug = useRef<ProviderSlug | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const [expandedSlug, setExpandedSlug] = useState<ProviderSlug | null>(activeCloudProvider || 'gemini');
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [onlyFreeModels, setOnlyFreeModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  const temperature = useConfigStore((s) => s.temperature);
  const setTemperature = useConfigStore((s) => s.setTemperature);
  const maxTokens = useConfigStore((s) => s.maxTokens);
  const setMaxTokens = useConfigStore((s) => s.setMaxTokens);
  const contextCompression = useConfigStore((s) => s.contextCompression);
  const setContextCompression = useConfigStore((s) => s.setContextCompression);
  const systemPromptEnabled = useConfigStore((s) => s.systemPromptEnabled);
  const setSystemPromptEnabled = useConfigStore((s) => s.setSystemPromptEnabled);

  useEffect(() => {
    loadCloudApiKeys();
  }, [loadCloudApiKeys]);

  const loadProviderForm = useCallback(
    async (slug: ProviderSlug) => {
      const state = useConfigStore.getState();
      const currentConfig = state.cloudProviders[slug] || DEFAULT_CLOUD_PROVIDERS[slug];
      const key = state.cloudApiKeys[slug] || '';
      if (!isMounted.current) return;
      activeFetchSlug.current = slug;
      setKeyInput(key);
      setModelInput(currentConfig?.model || '');
      setBaseUrlInput(currentConfig?.baseUrl || '');
      setTestResult(null);

      setModelFetchError(null);
      setIsFetchingModels(true);
      try {
        let models: string[] = [];
        if (slug === 'custom') {
          const res = await fetchCustomEndpointModels(currentConfig?.baseUrl || '', key);
          models = res.models;
          if (res.error && isMounted.current && activeFetchSlug.current === slug) {
            setModelFetchError(res.error);
          }
        } else {
          models = await fetchProviderModels(slug, key, currentConfig?.baseUrl);
        }
        if (isMounted.current && activeFetchSlug.current === slug) {
          setAvailableModels(models);
        }
      } finally {
        if (isMounted.current && activeFetchSlug.current === slug) {
          setIsFetchingModels(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (expandedSlug) {
      loadProviderForm(expandedSlug);
    }
  }, [expandedSlug, loadProviderForm]);

  const handleSelectProvider = (slug: ProviderSlug) => {
    if (expandedSlug === slug) {
      setExpandedSlug(null);
    } else {
      setExpandedSlug(slug);
    }
  };

  const handleSaveKey = async (slug: ProviderSlug) => {
    const rawClean = trimBearerToken(keyInput);
    if (!rawClean) {
      Alert.alert('Key Required', 'Please enter an API key.');
      return;
    }
    await setCloudApiKey(slug, rawClean);
    setKeyInput(rawClean);
    setCloudProviderConfig(slug, {
      model: modelInput.trim() || DEFAULT_CLOUD_PROVIDERS[slug].model,
      baseUrl: baseUrlInput.trim() || undefined,
    });
    Alert.alert('Saved', `${PROVIDER_METAS[slug].name} credentials saved.`);
  };

  const handleDeleteKey = async (slug: ProviderSlug) => {
    Alert.alert(
      'Remove Key',
      `Are you sure you want to remove credentials for ${PROVIDER_METAS[slug].name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteCloudApiKey(slug);
            setKeyInput('');
            setTestResult(null);
          },
        },
      ]
    );
  };

  const handleTestConnection = async (slug: ProviderSlug) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testProviderConnection(
        slug,
        trimBearerToken(keyInput),
        modelInput.trim(),
        baseUrlInput.trim()
      );
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || 'Connection failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRefreshModels = async (slug: ProviderSlug) => {
    setIsFetchingModels(true);
    setModelFetchError(null);
    try {
      let models: string[] = [];
      if (slug === 'custom') {
        const res = await fetchCustomEndpointModels(baseUrlInput.trim(), trimBearerToken(keyInput));
        models = res.models;
        if (res.error) {
          setModelFetchError(res.error);
        }
      } else {
        models = await fetchProviderModels(slug, trimBearerToken(keyInput), baseUrlInput.trim(), true);
      }
      setAvailableModels(models);
    } finally {
      setIsFetchingModels(false);
    }
  };

  return (
    <AuroraScreen
      title="Cloud Providers"
      subtitle="Direct cloud model streaming from your device via the Vercel AI SDK. All data remains in local SQLite."
    >
      {connectionMode !== 'cloud' && (
        <Card style={{ borderColor: aurora.acc1, borderWidth: 1 }}>
          <View style={styles.activateRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '700' }}>
                Cloud Mode Inactive
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>
                Current mode: {connectionMode.toUpperCase()}. Switch to Cloud mode to route chats through direct cloud APIs.
              </Text>
            </View>
            <Pressable
              style={[styles.smallActionBtn, { backgroundColor: aurora.acc1 }]}
              onPress={() => setConnectionMode('cloud')}
            >
              <Text style={{ color: aurora.onAccent, fontWeight: '700', fontSize: sizes.sub }}>
                Activate
              </Text>
            </Pressable>
          </View>
        </Card>
      )}

      {PROVIDER_SLUGS.map((slug) => {
        const meta = PROVIDER_METAS[slug];
        const hasKey = Boolean(cloudApiKeys[slug]);
        const isActive = activeCloudProvider === slug;
        const isExpanded = expandedSlug === slug;
        const currentModel = cloudProviders[slug]?.model || DEFAULT_CLOUD_PROVIDERS[slug].model;

        return (
          <Card key={slug}>
            <Pressable onPress={() => handleSelectProvider(slug)} style={styles.cardHeader}>
              <View style={styles.providerInfo}>
                <Text style={{ fontSize: 24, marginRight: 12 }}>{meta.icon}</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleBadgeRow}>
                    <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '700' }}>
                      {meta.name}
                    </Text>
                    {isActive && (
                      <View style={[styles.badge, { backgroundColor: '#10b98120', borderColor: '#10b981' }]}>
                        <Text style={[styles.badgeText, { color: '#10b981' }]}>ACTIVE</Text>
                      </View>
                    )}
                    {hasKey ? (
                      <View style={[styles.badge, { backgroundColor: '#3b82f620', borderColor: '#3b82f6' }]}>
                        <Text style={[styles.badgeText, { color: '#3b82f6' }]}>CONFIGURED</Text>
                      </View>
                    ) : (
                      <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: colors.glassBorder }]}>
                        <Text style={[styles.badgeText, { color: colors.textMuted }]}>NOT SET</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 2 }}>
                    {meta.description}
                  </Text>
                  {hasKey && currentModel && (
                    <Text style={{ color: aurora.acc2, fontSize: sizes.sub - 1, marginTop: 4 }}>
                      Model: {currentModel}
                    </Text>
                  )}
                </View>
                <Text style={{ color: colors.textMuted, fontSize: sizes.text, marginLeft: 8 }}>
                  {isExpanded ? '▲' : '▼'}
                </Text>
              </View>
            </Pressable>

            {isExpanded && (
              <View style={styles.expandedContent}>
                <View style={styles.divider} />

                {slug === 'openrouter' && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginBottom: 6 }}>
                      Free Model Quick-Chip:
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Quick-chip gpt-oss-120b:free"
                      style={[
                        styles.quickChip,
                        { borderColor: aurora.acc1, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
                      ]}
                      onPress={() => {
                        setModelInput(OPENROUTER_FREE_MODEL);
                        setBaseUrlInput(OPENROUTER_BASE_URL);
                      }}
                    >
                      <Text style={{ color: aurora.acc1, fontWeight: '700', fontSize: sizes.sub }}>
                        ⚡ {OPENROUTER_FREE_MODEL}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 2 }}>
                        One-tap free OpenRouter model
                      </Text>
                    </Pressable>
                  </View>
                )}

                {slug === 'custom' && (
                  <View style={{ marginBottom: 12 }}>
                    <Field
                      label="Base URL"
                      placeholder="https://api.together.xyz/v1"
                      value={baseUrlInput}
                      onChangeText={setBaseUrlInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                )}

                <View style={{ marginBottom: 12 }}>
                  <Field
                    label="API Key"
                    placeholder={`Enter ${meta.name} API Key`}
                    value={keyInput}
                    onChangeText={setKeyInput}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {meta.docsUrl ? (
                    <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 2, marginTop: 4 }}>
                      Get key: {meta.docsUrl}
                    </Text>
                  ) : null}
                </View>

                <View style={{ marginBottom: 12 }}>
                  <View style={styles.modelHeaderRow}>
                    <Field
                      label="Model Name"
                      placeholder="e.g. gpt-4o, gemini-1.5-flash"
                      value={modelInput}
                      onChangeText={setModelInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ flex: 1 }}
                    />
                  </View>

                  <View style={styles.filterRefreshRow}>
                    <Pressable
                      style={styles.freeFilterToggle}
                      onPress={() => setOnlyFreeModels(!onlyFreeModels)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: onlyFreeModels }}
                    >
                      <Switch
                        value={onlyFreeModels}
                        onValueChange={setOnlyFreeModels}
                        trackColor={{ false: colors.border, true: aurora.acc1 + '80' }}
                        thumbColor={onlyFreeModels ? aurora.acc1 : colors.textMuted}
                        accessibilityLabel="Free models filter"
                      />
                      <Text style={{ color: colors.text, fontSize: sizes.sub - 1, marginLeft: 6 }}>
                        Free Models Only
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handleRefreshModels(slug)}
                      disabled={isFetchingModels}
                      style={{ paddingVertical: 4, paddingHorizontal: 6 }}
                    >
                      <Text style={{ color: aurora.acc1, fontSize: sizes.sub - 1 }}>
                        {isFetchingModels ? 'Fetching...' : '↻ Refresh Models'}
                      </Text>
                    </Pressable>
                  </View>

                  {modelFetchError ? (
                    <Text style={{ color: '#ef4444', fontSize: sizes.sub - 1, marginTop: 4 }}>
                      ⚠️ {modelFetchError}
                    </Text>
                  ) : null}

                  {(() => {
                    const displayed = onlyFreeModels
                      ? availableModels.filter(isFreeModelId)
                      : availableModels;

                    if (displayed.length > 0) {
                      return (
                        <View style={{ marginTop: 8 }}>
                          <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 2, marginBottom: 4 }}>
                            {onlyFreeModels ? 'Free Models Available:' : 'Available Models:'}
                          </Text>
                          <ChipGroup
                            options={displayed.slice(0, 10).map((m) => ({ value: m, label: m }))}
                            value={modelInput}
                            onChange={(m) => setModelInput(m)}
                          />
                        </View>
                      );
                    }
                    if (onlyFreeModels && availableModels.length > 0) {
                      return (
                        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 6, fontStyle: 'italic' }}>
                          No free models found in endpoint list.
                        </Text>
                      );
                    }
                    return null;
                  })()}
                </View>

                {testResult && (
                  <View
                    style={[
                      styles.testResultBox,
                      {
                        borderColor: testResult.ok ? '#10b981' : '#ef4444',
                        backgroundColor: testResult.ok ? '#10b98115' : '#ef444415',
                      },
                    ]}
                  >
                    <Text style={{ color: testResult.ok ? '#10b981' : '#ef4444', fontSize: sizes.sub }}>
                      {testResult.ok ? '✓ ' : '✗ '}
                      {testResult.message}
                    </Text>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <PrimaryButton
                    label="Save Key"
                    onPress={() => handleSaveKey(slug)}
                  />
                  <SecondaryButton
                    label={isTesting ? 'Testing...' : 'Test'}
                    onPress={() => handleTestConnection(slug)}
                    disabled={isTesting}
                  />
                  {!isActive && (
                    <SecondaryButton
                      label="Set Active"
                      onPress={() => {
                        setActiveCloudProvider(slug);
                        setConnectionMode('cloud');
                      }}
                    />
                  )}
                  {hasKey && (
                    <DangerButton
                      label="Remove"
                      onPress={() => handleDeleteKey(slug)}
                    />
                  )}
                </View>
              </View>
            )}
          </Card>
        );
      })}

      <Card>
        <Label>Inference & Prompt Controls</Label>
        <Text style={[styles.controlHelper, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
          Fine-tune streaming temperature, token budget, context truncation, and system prompt injection.
        </Text>

        <View style={{ marginTop: 14 }}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                Context Compression
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 2 }}>
                Truncates long conversation history to 30 messages to conserve token budgets.
              </Text>
            </View>
            <Switch
              value={contextCompression}
              onValueChange={setContextCompression}
              trackColor={{ false: colors.border, true: aurora.acc1 + '80' }}
              thumbColor={contextCompression ? aurora.acc1 : colors.textMuted}
              accessibilityLabel="Context Compression Switch"
            />
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                System Prompt Enabled
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 2 }}>
                Injects persona instructions and active skills as system messages.
              </Text>
            </View>
            <Switch
              value={systemPromptEnabled}
              onValueChange={setSystemPromptEnabled}
              trackColor={{ false: colors.border, true: aurora.acc1 + '80' }}
              thumbColor={systemPromptEnabled ? aurora.acc1 : colors.textMuted}
              accessibilityLabel="System Prompt Enabled Switch"
            />
          </View>
        </View>

        <View style={{ marginTop: 16 }}>
          <Label>Temperature ({temperature.toFixed(1)})</Label>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease temperature"
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                pressed && { opacity: 0.7 },
                temperature <= 0 && { opacity: 0.4 },
              ]}
              onPress={() => setTemperature(Math.max(0, Math.round((temperature - 0.1) * 10) / 10))}
              disabled={temperature <= 0}
            >
              <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>−</Text>
            </Pressable>
            <View
              style={[
                styles.tempTrack,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
              ]}
            >
              <View
                style={[
                  styles.tempFill,
                  {
                    width: `${Math.min(100, Math.max(0, temperature * 100))}%`,
                    backgroundColor: aurora.acc1,
                  },
                ]}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase temperature"
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                pressed && { opacity: 0.7 },
                temperature >= 1.0 && { opacity: 0.4 },
              ]}
              onPress={() => setTemperature(Math.min(1.0, Math.round((temperature + 0.1) * 10) / 10))}
              disabled={temperature >= 1.0}
            >
              <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: 16 }}>
          <Label>Max Tokens ({maxTokens})</Label>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease max tokens"
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                pressed && { opacity: 0.7 },
                maxTokens <= 256 && { opacity: 0.4 },
              ]}
              onPress={() => setMaxTokens(Math.max(256, maxTokens - 256))}
              disabled={maxTokens <= 256}
            >
              <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>−</Text>
            </Pressable>
            <Field
              label=""
              value={String(maxTokens)}
              onChangeText={(txt) => {
                const parsed = parseInt(txt.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(parsed)) {
                  setMaxTokens(Math.max(1, parsed));
                } else if (txt === '') {
                  setMaxTokens(256);
                }
              }}
              keyboardType="numeric"
              style={{ flex: 1, textAlign: 'center' }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase max tokens"
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                pressed && { opacity: 0.7 },
                maxTokens >= 32768 && { opacity: 0.4 },
              ]}
              onPress={() => setMaxTokens(Math.min(32768, maxTokens + 256))}
              disabled={maxTokens >= 32768}
            >
              <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>+</Text>
            </Pressable>
          </View>
        </View>
      </Card>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  activateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  smallActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cardHeader: {
    paddingVertical: 4,
  },
  providerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  expandedContent: {
    marginTop: 12,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  testResultBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'column',
    gap: 2,
    alignSelf: 'flex-start',
  },
  modelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterRefreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 4,
  },
  freeFilterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlHelper: {
    marginTop: 4,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tempTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tempFill: {
    height: '100%',
    borderRadius: 5,
  },
});
