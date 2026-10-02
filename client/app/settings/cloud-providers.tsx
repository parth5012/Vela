import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
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
import { fetchProviderModels, testProviderConnection } from '../../utils/providers/models';

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

      setIsFetchingModels(true);
      try {
        const models = await fetchProviderModels(slug, key, currentConfig?.baseUrl);
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
    if (!keyInput.trim()) {
      Alert.alert('Key Required', 'Please enter an API key.');
      return;
    }
    await setCloudApiKey(slug, keyInput.trim());
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
        keyInput.trim(),
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
    try {
      const models = await fetchProviderModels(slug, keyInput.trim(), baseUrlInput.trim(), true);
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
                  <Field
                    label="Model Name"
                    placeholder="e.g. gpt-4o, gemini-1.5-flash"
                    value={modelInput}
                    onChangeText={setModelInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    onPress={() => handleRefreshModels(slug)}
                    disabled={isFetchingModels}
                    style={{ alignSelf: 'flex-end', marginTop: 4 }}
                  >
                    <Text style={{ color: aurora.acc1, fontSize: sizes.sub - 1 }}>
                      {isFetchingModels ? 'Fetching...' : '↻ Refresh Models'}
                    </Text>
                  </Pressable>

                  {availableModels.length > 0 && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 2, marginBottom: 4 }}>
                        Available Models:
                      </Text>
                      <ChipGroup
                        options={availableModels.slice(0, 10).map((m) => ({ value: m, label: m }))}
                        value={modelInput}
                        onChange={(m) => setModelInput(m)}
                      />
                    </View>
                  )}
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
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
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
});
