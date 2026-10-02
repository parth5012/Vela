import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
} from 'react-native';
import {
  useConfigStore,
  ProviderSlug,
  DEFAULT_CLOUD_PROVIDERS,
} from '../store/useConfigStore';
import { syncHistoryWithBackend } from '../utils/history';
import { testProviderConnection } from '../utils/providers/models';

type SetupStep = 'fork' | 'server' | 'standalone';
type StandaloneSubtype = 'cloud' | 'local';

const CLOUD_OPTIONS: { slug: ProviderSlug; label: string }[] = [
  { slug: 'gemini', label: 'Gemini' },
  { slug: 'openai', label: 'OpenAI' },
  { slug: 'anthropic', label: 'Anthropic' },
  { slug: 'groq', label: 'Groq' },
  { slug: 'openrouter', label: 'OpenRouter' },
  { slug: 'custom', label: 'Custom' },
];

const HEADER_TEXTS: Record<SetupStep, { title: string; subtitle: string }> = {
  fork: {
    title: 'Get Started with Vela',
    subtitle: 'Choose how you would like to run Vela on this device:',
  },
  server: {
    title: 'Connect to Server',
    subtitle: 'Configure your self-hosted Vela instance to synchronize and manage tasks.',
  },
  standalone: {
    title: 'Run Standalone',
    subtitle: 'Direct inference without a backend server using Cloud APIs or local models.',
  },
};

export default function SetupScreen() {
  const [step, setStep] = useState<SetupStep>('fork');
  const [standaloneSubtype, setStandaloneSubtype] = useState<StandaloneSubtype>('cloud');

  // Server state
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Standalone cloud state
  const [cloudProvider, setCloudProvider] = useState<ProviderSlug>('gemini');
  const [cloudKey, setCloudKey] = useState('');
  const [cloudModel, setCloudModel] = useState(DEFAULT_CLOUD_PROVIDERS.gemini.model);
  const [customBaseUrl, setCustomBaseUrl] = useState('');

  // Status state
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const isMounted = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const setConfig = useConfigStore((state) => state.setConfig);
  const setConnectionMode = useConfigStore((state) => state.setConnectionMode);
  const setActiveCloudProvider = useConfigStore((state) => state.setActiveCloudProvider);
  const setCloudProviderConfig = useConfigStore((state) => state.setCloudProviderConfig);
  const setCloudApiKey = useConfigStore((state) => state.setCloudApiKey);
  const localModelName = useConfigStore((state) => state.localModelName);

  const handleSelectProvider = (slug: ProviderSlug) => {
    setCloudProvider(slug);
    setCloudModel(DEFAULT_CLOUD_PROVIDERS[slug].model);
    setCloudKey('');
    if (slug !== 'custom') {
      setCustomBaseUrl('');
    }
    setError('');
    setSuccess(false);
  };

  const handleConnectServer = async () => {
    Keyboard.dismiss();

    if (!apiUrl.trim()) {
      if (isMounted.current) setError('API URL is required');
      return;
    }
    if (!apiKey.trim()) {
      if (isMounted.current) setError('API Key is required');
      return;
    }

    let formattedUrl = apiUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }
    formattedUrl = formattedUrl.replace(/\/+$/, '');

    try {
      if (isMounted.current) {
        setIsTesting(true);
        setError('');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${formattedUrl}/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        if (isMounted.current) {
          setIsTesting(false);
          setSuccess(true);
          setError('');
        }

        const transition = () => {
          setConfig(formattedUrl, apiKey.trim());
          setConnectionMode('server');
          syncHistoryWithBackend(formattedUrl, apiKey.trim());
        };

        if (process.env.NODE_ENV === 'test') {
          transition();
        } else {
          timerRef.current = setTimeout(transition, 1500);
        }
        return;
      } else {
        if (isMounted.current) {
          setError(`Failed to connect. Server returned status: ${response.status}`);
        }
      }
    } catch (err: any) {
      if (isMounted.current) {
        if (err.name === 'AbortError') {
          setError('Connection timed out. Please verify your URL and network.');
        } else {
          setError(err.message || 'Failed to connect. Please check URL and credentials.');
        }
      }
    } finally {
      if (isMounted.current) {
        setIsTesting(false);
      }
    }
  };

  const handleConnectCloud = async () => {
    Keyboard.dismiss();

    if (!cloudKey.trim()) {
      if (isMounted.current) setError('API key is required for cloud mode');
      return;
    }

    let normalizedBaseUrl = customBaseUrl.trim();
    if (cloudProvider === 'custom') {
      if (!normalizedBaseUrl) {
        if (isMounted.current) setError('Base URL is required for custom provider');
        return;
      }
      if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
        normalizedBaseUrl = `https://${normalizedBaseUrl}`;
      }
      normalizedBaseUrl = normalizedBaseUrl.replace(/\/+$/, '');

      if (!cloudModel.trim()) {
        if (isMounted.current) setError('Model name is required for custom provider');
        return;
      }
    }

    try {
      if (isMounted.current) {
        setIsTesting(true);
        setError('');
      }

      const testResult = await testProviderConnection(
        cloudProvider,
        cloudKey.trim(),
        cloudModel.trim(),
        normalizedBaseUrl
      );

      if (!testResult.ok) {
        if (isMounted.current) {
          setError(testResult.message || 'Connection test failed');
          setIsTesting(false);
        }
        return;
      }

      if (isMounted.current) {
        setIsTesting(false);
        setSuccess(true);
        setError('');
      }

      const transition = async () => {
        try {
          await setCloudApiKey(cloudProvider, cloudKey.trim());
          setCloudProviderConfig(cloudProvider, {
            model: cloudModel.trim() || DEFAULT_CLOUD_PROVIDERS[cloudProvider].model,
            baseUrl: cloudProvider === 'custom' ? normalizedBaseUrl : undefined,
          });
          setActiveCloudProvider(cloudProvider);
          setConnectionMode('cloud');
        } catch (err: any) {
          if (isMounted.current) {
            setError(err?.message || 'Failed to save cloud credentials');
            setIsTesting(false);
          }
        }
      };

      if (process.env.NODE_ENV === 'test') {
        await transition();
      } else {
        timerRef.current = setTimeout(() => {
          void transition();
        }, 1200);
      }
    } catch (err: any) {
      if (isMounted.current) {
        setError(err.message || 'Failed to connect to cloud provider.');
      }
    } finally {
      if (isMounted.current && !success) {
        setIsTesting(false);
      }
    }
  };

  const handleConnectLocal = async () => {
    setConnectionMode('local');
  };

  const header = HEADER_TEXTS[step];
  const inputEditable = !isTesting && !success;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.innerContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.headerContainer}>
            <Text style={styles.logo}>VELA</Text>
            <Text style={styles.title}>{header.title}</Text>
            <Text style={styles.subtitle}>{header.subtitle}</Text>
          </View>

          {step === 'fork' && (
            <View style={styles.forkContainer}>
              <Pressable
                style={({ pressed }) => [styles.forkCard, pressed && styles.forkCardPressed]}
                onPress={() => setStep('server')}
              >
                <Text style={styles.forkIcon}>🖥️</Text>
                <View style={styles.forkTextContainer}>
                  <Text style={styles.forkTitle}>Connect to Server</Text>
                  <Text style={styles.forkSubtitle}>
                    Connect to your self-hosted Vela FastAPI instance for syncing and agent orchestration.
                  </Text>
                </View>
                <Text style={styles.forkArrow}>›</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.forkCard, pressed && styles.forkCardPressed]}
                onPress={() => setStep('standalone')}
              >
                <Text style={styles.forkIcon}>✨</Text>
                <View style={styles.forkTextContainer}>
                  <Text style={styles.forkTitle}>Run Standalone</Text>
                  <Text style={styles.forkSubtitle}>
                    Run standalone without a server using direct Cloud APIs or On-Device Local AI.
                  </Text>
                </View>
                <Text style={styles.forkArrow}>›</Text>
              </Pressable>
            </View>
          )}

          {step === 'server' && (
            <View style={styles.formContainer}>
              <Pressable onPress={() => { setStep('fork'); setError(''); }} style={styles.backButton}>
                <Text style={styles.backButtonText}>‹ Back</Text>
              </Pressable>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Server URL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://api.vela.local"
                  placeholderTextColor="#71717a"
                  value={apiUrl}
                  editable={inputEditable}
                  onChangeText={(text) => {
                    setApiUrl(text);
                    if (error) setError('');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>API Access Key</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your API access token"
                  placeholderTextColor="#71717a"
                  value={apiKey}
                  editable={inputEditable}
                  onChangeText={(text) => {
                    setApiKey(text);
                    if (error) setError('');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {success ? (
                <Text style={styles.successText}>✓ Credentials verified successfully! Starting node...</Text>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: success ? '#10b981' : '#6366f1' },
                  pressed && { backgroundColor: success ? '#059669' : '#4f46e5' },
                  (isTesting || success) && styles.buttonDisabled,
                ]}
                onPress={handleConnectServer}
                disabled={isTesting || success}
              >
                {isTesting ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>{success ? '✓ Connected' : 'Connect & Save'}</Text>
                )}
              </Pressable>
            </View>
          )}

          {step === 'standalone' && (
            <View style={styles.formContainer}>
              <Pressable onPress={() => { setStep('fork'); setError(''); }} style={styles.backButton}>
                <Text style={styles.backButtonText}>‹ Back</Text>
              </Pressable>

              <View style={styles.subtabContainer}>
                <Pressable
                  style={[
                    styles.subtab,
                    standaloneSubtype === 'cloud' && styles.subtabActive,
                  ]}
                  onPress={() => { setStandaloneSubtype('cloud'); setError(''); }}
                >
                  <Text
                    style={[
                      styles.subtabText,
                      standaloneSubtype === 'cloud' && styles.subtabTextActive,
                    ]}
                  >
                    Cloud APIs
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.subtab,
                    standaloneSubtype === 'local' && styles.subtabActive,
                  ]}
                  onPress={() => { setStandaloneSubtype('local'); setError(''); }}
                >
                  <Text
                    style={[
                      styles.subtabText,
                      standaloneSubtype === 'local' && styles.subtabTextActive,
                    ]}
                  >
                    On-Device Local AI
                  </Text>
                </Pressable>
              </View>

              {standaloneSubtype === 'cloud' ? (
                <View>
                  <Text style={styles.label}>Select Cloud Provider</Text>
                  <View style={styles.pillRow}>
                    {CLOUD_OPTIONS.map((opt) => (
                      <Pressable
                        key={opt.slug}
                        style={[
                          styles.pill,
                          cloudProvider === opt.slug && styles.pillSelected,
                        ]}
                        onPress={() => handleSelectProvider(opt.slug)}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            cloudProvider === opt.slug && styles.pillTextSelected,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {cloudProvider === 'custom' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>Base URL</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="https://api.together.xyz/v1"
                        placeholderTextColor="#71717a"
                        value={customBaseUrl}
                        editable={inputEditable}
                        onChangeText={setCustomBaseUrl}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  )}

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>API Key</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={`Enter ${cloudProvider.toUpperCase()} API Key`}
                      placeholderTextColor="#71717a"
                      value={cloudKey}
                      editable={inputEditable}
                      onChangeText={(t) => {
                        setCloudKey(t);
                        if (error) setError('');
                      }}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Model Name</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. gemini-1.5-flash"
                      placeholderTextColor="#71717a"
                      value={cloudModel}
                      editable={inputEditable}
                      onChangeText={setCloudModel}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  {success ? (
                    <Text style={styles.successText}>✓ Cloud provider connected successfully!</Text>
                  ) : null}

                  <Pressable
                    style={({ pressed }) => [
                      styles.button,
                      { backgroundColor: success ? '#10b981' : '#6366f1' },
                      pressed && { backgroundColor: success ? '#059669' : '#4f46e5' },
                      (isTesting || success) && styles.buttonDisabled,
                    ]}
                    onPress={handleConnectCloud}
                    disabled={isTesting || success}
                  >
                    {isTesting ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>{success ? '✓ Ready' : 'Test & Start'}</Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View>
                  <View style={styles.localInfoContainer}>
                    <Text style={styles.localTitle}>On-Device Inference</Text>
                    <Text style={styles.localSubtitle}>
                      Runs models locally using llama.rn and GGUF. Zero data leaves your device.
                    </Text>
                  </View>
                  <View style={styles.modelInfoCard}>
                    <Text style={styles.modelNameLabel}>
                      Default Model: {localModelName}
                    </Text>
                    <Text style={styles.modelHint}>
                      You can download or switch models anytime from Settings.
                    </Text>
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.button,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleConnectLocal}
                  >
                    <Text style={styles.buttonText}>Start with Local AI</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  innerContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 24,
    fontWeight: '900',
    color: '#818cf8',
    letterSpacing: 4,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#f4f4f5',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  forkContainer: {
    gap: 16,
  },
  forkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  forkCardPressed: {
    backgroundColor: '#27272a',
    borderColor: '#6366f1',
  },
  forkIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  forkTextContainer: {
    flex: 1,
  },
  forkTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f4f4f5',
    marginBottom: 4,
  },
  forkSubtitle: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 18,
  },
  forkArrow: {
    fontSize: 24,
    color: '#71717a',
    marginLeft: 8,
  },
  formContainer: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  backButton: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: '#818cf8',
    fontSize: 14,
    fontWeight: '600',
  },
  subtabContainer: {
    flexDirection: 'row',
    backgroundColor: '#09090b',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  subtab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  subtabActive: {
    backgroundColor: '#27272a',
  },
  subtabText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
  },
  subtabTextActive: {
    color: '#f4f4f5',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#09090b',
  },
  pillSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  pillText: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#f4f4f5',
  },
  localInfoContainer: {
    marginBottom: 16,
  },
  localTitle: {
    color: '#f4f4f5',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  localSubtitle: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 20,
  },
  modelInfoCard: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  modelNameLabel: {
    color: '#818cf8',
    fontWeight: '700',
    fontSize: 14,
  },
  modelHint: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 4,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f4f4f5',
    fontSize: 15,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonPressed: {
    backgroundColor: '#4f46e5',
  },
  buttonDisabled: {
    backgroundColor: '#3730a3',
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  successText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
    textAlign: 'center',
  },
});
