import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  Animated,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { DURATIONS, EASING } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  useConfigStore,
  ProviderSlug,
  DEFAULT_CLOUD_PROVIDERS,
} from '../store/useConfigStore';
import { syncHistoryWithBackend } from '../utils/history';
import { testProviderConnection } from '../utils/providers/models';
import {
  requestPermission,
  checkPermission,
  getRationale,
  type PermissionStatus,
} from '../utils/permissionManager';
import type { RequestablePermission } from '../utils/setupPermissions';
import { registerAndPostToken } from '../utils/pushRegistration';
import AccessibilityGuide from '../components/ui/AccessibilityGuide';
import { styles } from '../styles/setupStyles';
import DeviceAgentNative from '../modules/device-agent';
import {
  deriveShizukuState,
  describeShizukuState,
  SHIZUKU_SETUP_GUIDE,
  type ShizukuState,
  type ShizukuStatus,
} from '../utils/shizuku';
import { useGoogleAuthStore } from '../store/useGoogleAuthStore';
import { parseOAuthCallbackUrl } from '../utils/oauthCallback';

type SetupStep = 'fork' | 'server' | 'standalone' | 'permissions' | 'integrations';
type StandaloneSubtype = 'cloud' | 'local';

// #556: the wizard asks notifications, camera and microphone as INDEPENDENT
// OS dialogs (each individually skippable, never blocking, no cascade), in
// this order. Accessibility is offered through AccessibilityGuide instead.
// The requestable keys come from utils/setupPermissions (single source).
const REQUESTABLE_ROWS: {
  perm: RequestablePermission;
  label: string;
  icon: string;
}[] = [
  { perm: 'notifications', label: 'Notifications', icon: '🔔' },
  { perm: 'camera', label: 'Camera', icon: '📷' },
  { perm: 'microphone', label: 'Microphone', icon: '🎙️' },
];

const CLOUD_OPTIONS: { slug: ProviderSlug; label: string }[] = [
  { slug: 'gemini', label: 'Gemini' },
  { slug: 'openai', label: 'OpenAI' },
  { slug: 'anthropic', label: 'Anthropic' },
  { slug: 'groq', label: 'Groq' },
  { slug: 'openrouter', label: 'OpenRouter' },
  { slug: 'custom', label: 'Custom' },
];

// WF-447-06: the setup steps are ordered as the feeling curve (see
// docs/FEELING-CURVE.md). fork = Recognition (what Vela is, one decision);
// the server/standalone forms = Tension (the effort of credentials); the
// permissions step (#556) keeps the Tension→Turn handoff honest — optional,
// individually skippable asks instead of a silent prompt; the verify success
// lines = Turn (effort converts into "Opening your chat."); the chat screen's
// empty state = Substance; the first send = Commitment.
const HEADER_TEXTS: Record<SetupStep, { title: string; subtitle: string }> = {
  fork: {
    title: 'Get Started with Vela',
    subtitle: 'One decision first: how should Vela run on this device?',
  },
  server: {
    title: 'Connect to Server',
    subtitle: 'Enter your self-hosted Vela address and key. Vela verifies them before opening your chat.',
  },
  standalone: {
    title: 'Run Standalone',
    subtitle: 'No backend needed. Bring a Cloud API key or run a model on this device.',
  },
  permissions: {
    title: 'Set Up Permissions',
    subtitle: 'Vela asks only for what it needs. Each one is optional — skip any and finish anytime.',
  },
  integrations: {
    title: 'Connect Integrations',
    subtitle: 'Optional extras. Each one is skippable — connect now or finish later from Settings.',
  },
};

// WF-447-06: the fork cards arrive as one staggered gesture. DURATIONS.stagger
// (left unapplied by WF-447-04, landed here by ticket) offsets the arrivals;
// transform/opacity only on the native driver, reveal duration, one easing
// curve. Reduced motion keeps the fade and drops the travel.
const forkCardMotion = (value: Animated.Value, reduceMotion: boolean) => [
  { opacity: value },
  {
    transform: [
      {
        translateY: reduceMotion
          ? 0
          : value.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
      },
    ],
  },
];

export default function SetupScreen() {
  const [step, setStep] = useState<SetupStep>('fork');
  const [standaloneSubtype, setStandaloneSubtype] = useState<StandaloneSubtype>('cloud');
  // #557: which connection path the wizard took, so the integrations step
  // knows whether to show the Google Workspace (server-only) row.
  const [wizardMode, setWizardMode] = useState<'server' | 'cloud' | 'local' | null>(null);

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

  // #556: permissions step state. Outcomes are persisted to the config store
  // via setOSPermission so the chat banner ("finish setup later") can derive
  // from them. `pendingTransition` holds the connection finalize step until
  // the user finishes the permissions step.
  const [permStatuses, setPermStatuses] = useState<
    Record<RequestablePermission, PermissionStatus>
  >({
    notifications: 'undetermined',
    camera: 'undetermined',
    microphone: 'undetermined',
  });
  const [guideVisible, setGuideVisible] = useState(false);
  const pendingTransition = useRef<(() => void | Promise<void>) | null>(null);

  // #557: Google Workspace integration row state (server mode only).
  const [googleStatus, setGoogleStatus] = useState<'unknown' | 'checking' | 'connected' | 'not_connected'>('checking');
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // #557: Shizuku integration row state (all modes).
  const [shizukuStatus, setShizukuStatus] = useState<ShizukuStatus | null>(null);
  const [shizukuChecking, setShizukuChecking] = useState(false);
  const [shizukuRequesting, setShizukuRequesting] = useState(false);
  const [shizukuRequestResult, setShizukuRequestResult] = useState<string | null>(null);

  const isMounted = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WF-447-06: one staggered arrival for the fork cards (the Recognition beat).
  // The group resets each time the fork step mounts so returning via Back
  // replays the same gesture.
  const reduceMotion = useReducedMotion();
  const forkEntrances = useRef([new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    if (step !== 'fork') return;
    if (reduceMotion) {
      forkEntrances.forEach((value) => value.setValue(1));
      return;
    }
    forkEntrances.forEach((value) => value.setValue(0));
    Animated.stagger(
      DURATIONS.stagger,
      forkEntrances.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: DURATIONS.reveal,
          easing: EASING.out,
          useNativeDriver: true,
        })
      )
    ).start();
  }, [step, reduceMotion, forkEntrances]);

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
  const setOSPermission = useConfigStore((state) => state.setOSPermission);

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
          setWizardMode('server');
        }

        const transition = () => {
          setConfig(formattedUrl, apiKey.trim());
          setConnectionMode('server');
          syncHistoryWithBackend(formattedUrl, apiKey.trim());
        };

        // #556: don't finalize yet — the permissions step runs before the
        // chat, and Finish applies the transition.
        pendingTransition.current = transition;
        if (process.env.NODE_ENV === 'test') {
          setStep('permissions');
        } else {
          timerRef.current = setTimeout(() => setStep('permissions'), 1500);
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
        setWizardMode('cloud');
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

      // #556: don't finalize yet — the permissions step runs before the
      // chat, and Finish applies the transition.
      pendingTransition.current = transition;
      if (process.env.NODE_ENV === 'test') {
        setStep('permissions');
      } else {
        timerRef.current = setTimeout(() => setStep('permissions'), 1200);
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

  const handleConnectLocal = () => {
    // #556: don't finalize yet — the permissions step runs before the chat.
    setWizardMode('local');
    pendingTransition.current = () => {
      setConnectionMode('local');
    };
    setStep('permissions');
  };

  // #556: fire ONE OS dialog for this permission (independent, no cascade).
  const handleRequestPermission = async (perm: RequestablePermission) => {
    const status = await requestPermission(perm);
    setPermStatuses((prev) => ({ ...prev, [perm]: status }));
    setOSPermission(perm, status);
  };

  // #556: "Not now" skips just this one — persist the current OS state
  // (honest 'undetermined' when never asked) without firing a dialog.
  const handleSkipPermission = async (perm: RequestablePermission) => {
    const status = await checkPermission(perm);
    setPermStatuses((prev) => ({ ...prev, [perm]: status }));
    setOSPermission(perm, status);
  };

  // #557: when the integrations step mounts, refresh live status for the
  // rows shown in this mode. Never throws — failures just show "not connected".
  useEffect(() => {
    if (step !== 'integrations') return;
    let cancelled = false;

    const checkGoogle = async () => {
      if (wizardMode !== 'server') return;
      const apiUrlRaw = useConfigStore.getState().apiUrl;
      const apiKey = useConfigStore.getState().apiKey;
      if (!apiUrlRaw || !apiKey) {
        if (!cancelled) setGoogleStatus('not_connected');
        return;
      }
      if (!cancelled) setGoogleStatus('checking');
      try {
        const base = apiUrlRaw.replace(/\/+$/, '');
        const res = await fetch(`${base}/oauth/token/status`, {
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setGoogleStatus(data.connected === true ? 'connected' : 'not_connected');
          useGoogleAuthStore.getState().setBackendConnected(data.connected === true);
          if (data.connected && data.user) {
            useGoogleAuthStore.getState().setUser({
              name: data.user.name || 'Google User',
              email: data.user.email || '',
              picture: data.user.picture || undefined,
            });
          }
        } else {
          setGoogleStatus('not_connected');
        }
      } catch {
        if (!cancelled) setGoogleStatus('not_connected');
      }
    };

    const checkShizuku = async () => {
      if (!cancelled) setShizukuChecking(true);
      try {
        const native = DeviceAgentNative as any;
        if (native && typeof native.getShizukuStatus === 'function') {
          const status = await native.getShizukuStatus();
          if (!cancelled) setShizukuStatus(status ?? null);
        } else {
          if (!cancelled) setShizukuStatus(null);
        }
      } catch {
        if (!cancelled) setShizukuStatus(null);
      } finally {
        if (!cancelled) setShizukuChecking(false);
      }
    };

    // Record that the wizard showed the Google step so the chat banner can
    // surface a gap if it stays unconnected.
    if (wizardMode === 'server') {
      useConfigStore.getState().setGoogleSetupPending(true);
    }

    void checkGoogle();
    void checkShizuku();

    return () => {
      cancelled = true;
    };
  }, [step, wizardMode]);

  const handleConnectGoogle = async () => {
    const apiUrlRaw = useConfigStore.getState().apiUrl;
    const apiKey = useConfigStore.getState().apiKey;
    if (!apiUrlRaw) {
      setGoogleError('Server URL is not configured.');
      return;
    }
    setGoogleSigningIn(true);
    setGoogleError(null);
    try {
      const redirectUri = 'vela-client://oauth/callback';
      const base = apiUrlRaw.replace(/\/+$/, '');
      const authUrl = `${base}/oauth/google/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&api_key=${encodeURIComponent(apiKey || '')}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type === 'success' && result.url) {
        // Parse the backend's verdict from the redirect URL (canonical flow).
        const callback = parseOAuthCallbackUrl(result.url);
        if (callback.status === 'error') {
          setGoogleError(callback.message || 'Google sign-in failed.');
          setGoogleStatus('not_connected');
        } else {
          // Poll briefly to confirm connection (canonical pattern, bounded).
          for (let i = 0; i < 5; i++) {
            try {
              const res = await fetch(`${base}/oauth/token/status`, {
                headers: { Authorization: `Bearer ${(apiKey || '').trim()}` },
              });
              if (res.ok) {
                const data = await res.json();
                if (data.connected === true) {
                  setGoogleStatus('connected');
                  useGoogleAuthStore.getState().setBackendConnected(true);
                  if (data.user) {
                    useGoogleAuthStore.getState().setUser({
                      name: data.user.name || 'Google User',
                      email: data.user.email || '',
                      picture: data.user.picture || undefined,
                    });
                  }
                  if (data.access_token) {
                    useGoogleAuthStore.getState().setTokens({
                      accessToken: data.access_token,
                      refreshToken: data.refresh_token,
                      idToken: data.id_token,
                      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : 0,
                    });
                  }
                  break;
                }
                setGoogleStatus('not_connected');
              }
            } catch {
              setGoogleStatus('not_connected');
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } else if (result.type === 'cancel') {
        setGoogleError('Google sign-in was cancelled.');
      } else if (result.type === 'dismiss') {
        setGoogleError('Google sign-in was dismissed.');
      }
    } catch (err: any) {
      setGoogleError(err?.message || 'Google sign-in failed.');
    } finally {
      setGoogleSigningIn(false);
    }
  };

  const handleRecheckShizuku = async () => {
    setShizukuChecking(true);
    setShizukuRequestResult(null);
    try {
      const native = DeviceAgentNative as any;
      if (native && typeof native.getShizukuStatus === 'function') {
        const status = await native.getShizukuStatus();
        setShizukuStatus(status ?? null);
      } else {
        setShizukuStatus(null);
      }
    } catch {
      setShizukuStatus(null);
    } finally {
      setShizukuChecking(false);
    }
  };

  const handleRequestShizuku = async () => {
    setShizukuRequesting(true);
    setShizukuRequestResult(null);
    try {
      const native = DeviceAgentNative as any;
      if (native && typeof native.requestShizukuPermission === 'function') {
        const result = await native.requestShizukuPermission();
        setShizukuRequestResult(String(result ?? 'requested'));
      } else {
        setShizukuRequestResult('Unavailable in this build.');
      }
    } catch (err: any) {
      setShizukuRequestResult(err?.message || 'Request failed.');
    } finally {
      setShizukuRequesting(false);
    }
    await handleRecheckShizuku();
  };

  // #556: Finish finalizes the stashed connection transition, then — when the
  // wizard's notification ask was granted — runs push registration from the
  // wizard path. The silent post-setup prompt in _layout.tsx no longer
  // requests the dialog, so this is the single canonical request point.
  // NEVER blocks: Finish is available no matter what was skipped or denied.
  const handleFinishSetup = async () => {
    // Persist the accessibility outcome too — it is guide-only (granted in
    // system Settings), so the wizard re-checks on finish to keep the chat
    // banner invariant wizard-owned.
    try {
      const accessibilityStatus = await checkPermission('accessibility');
      setOSPermission('accessibility', accessibilityStatus);
    } catch {
      // ignore — the _layout polling effect records the OS state as fallback
    }

    const transition = pendingTransition.current;
    pendingTransition.current = null;
    if (transition) {
      await transition();
    }
    // Token registration is a server-mode concern: standalone-cloud/local
    // intentionally do not register push (no backend to post the token to).
    // The gate is explicit here rather than relying on the util's internal
    // apiUrl skip, so the intent is visible.
    if (
      useConfigStore.getState().connectionMode === 'server' &&
      useConfigStore.getState().osPermissions.notifications === 'granted'
    ) {
      void registerAndPostToken();
    }
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
              <Animated.View style={forkCardMotion(forkEntrances[0], reduceMotion)}>
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
              </Animated.View>

              <Animated.View style={forkCardMotion(forkEntrances[1], reduceMotion)}>
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
              </Animated.View>
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
                <Text style={styles.successText}>✓ Credentials verified.</Text>
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
                    <Text style={styles.successText}>✓ Cloud connected.</Text>
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

          {step === 'permissions' && (
            <View style={styles.formContainer}>
              {/* #556: three independent OS dialogs, each individually
                  skippable, never blocking. No cascade — one tap, one dialog. */}
              {REQUESTABLE_ROWS.map(({ perm, label, icon }) => (
                <View key={perm} style={styles.permRow}>
                  <Text style={styles.permIcon}>{icon}</Text>
                  <View style={styles.permTextContainer}>
                    <Text style={styles.permTitle}>{label}</Text>
                    <Text style={styles.permRationale}>{getRationale(perm)}</Text>
                    <Text style={styles.permStatus}>
                      {permStatuses[perm] === 'granted' ? '✓ Allowed' : 'Not set'}
                    </Text>
                  </View>
                  <View style={styles.permActions}>
                    <Pressable
                      accessibilityLabel={`Allow ${perm}`}
                      style={({ pressed }) => [styles.permBtn, pressed && styles.permBtnPressed]}
                      onPress={() => void handleRequestPermission(perm)}
                    >
                      <Text style={styles.permBtnText}>Allow</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Not now ${perm}`}
                      style={({ pressed }) => [styles.permSkip, pressed && styles.permBtnPressed]}
                      onPress={() => void handleSkipPermission(perm)}
                    >
                      <Text style={styles.permSkipText}>Not now</Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              {/* #556: accessibility goes through the step-by-step guide, not
                  an OS dialog. */}
              <View style={styles.permRow}>
                <Text style={styles.permIcon}>♿</Text>
                <View style={styles.permTextContainer}>
                  <Text style={styles.permTitle}>Accessibility</Text>
                  <Text style={styles.permRationale}>{getRationale('accessibility')}</Text>
                </View>
                <View style={styles.permActions}>
                  <Pressable
                    accessibilityLabel="Set up accessibility"
                    style={({ pressed }) => [styles.permBtn, pressed && styles.permBtnPressed]}
                    onPress={() => setGuideVisible(true)}
                  >
                    <Text style={styles.permBtnText}>Set up</Text>
                  </Pressable>
                </View>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                onPress={() => setStep('integrations')}
              >
                <Text style={styles.buttonText}>Continue</Text>
              </Pressable>
            </View>
          )}

          {step === 'integrations' && (
            <View style={styles.formContainer}>
              <Pressable onPress={() => setStep('permissions')} style={styles.backButton}>
                <Text style={styles.backButtonText}>‹ Back</Text>
              </Pressable>

              {wizardMode === 'server' && (
                <View style={styles.permRow}>
                  <Text style={styles.permIcon}>G</Text>
                  <View style={styles.permTextContainer}>
                    <Text style={styles.permTitle}>Google Workspace</Text>
                    <Text style={styles.permRationale}>
                      Connect Gmail, Calendar, and Drive for the Vela agent.
                    </Text>
                    <Text style={styles.permStatus}>
                      {googleStatus === 'connected'
                        ? '✓ Connected'
                        : googleStatus === 'checking'
                        ? 'Checking…'
                        : 'Not connected'}
                    </Text>
                    {googleError ? <Text style={styles.errorText}>{googleError}</Text> : null}
                  </View>
                  <View style={styles.permActions}>
                    {googleStatus !== 'connected' && (
                      <Pressable
                        accessibilityLabel="Connect Google"
                        style={({ pressed }) => [styles.permBtn, pressed && styles.permBtnPressed]}
                        onPress={() => void handleConnectGoogle()}
                        disabled={googleSigningIn}
                      >
                        {googleSigningIn ? (
                          <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                          <Text style={styles.permBtnText}>Connect</Text>
                        )}
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityLabel="Skip Google"
                      style={({ pressed }) => [styles.permSkip, pressed && styles.permBtnPressed]}
                      onPress={() => setGoogleStatus('not_connected')}
                    >
                      <Text style={styles.permSkipText}>Not now</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.permRow}>
                <Text style={styles.permIcon}>S</Text>
                <View style={styles.permTextContainer}>
                  <Text style={styles.permTitle}>Shizuku</Text>
                  <Text style={styles.permRationale}>
                    {shizukuStatus
                      ? describeShizukuState(deriveShizukuState(shizukuStatus))
                      : 'Device automation (optional).'}
                  </Text>
                  {shizukuRequestResult ? (
                    <Text style={styles.permStatus}>{shizukuRequestResult}</Text>
                  ) : null}
                </View>
                <View style={styles.permActions}>
                  {shizukuStatus && deriveShizukuState(shizukuStatus) === 'permission_denied' && (
                    <Pressable
                      accessibilityLabel="Request Shizuku permission"
                      style={({ pressed }) => [styles.permBtn, pressed && styles.permBtnPressed]}
                      onPress={() => void handleRequestShizuku()}
                      disabled={shizukuRequesting}
                    >
                      <Text style={styles.permBtnText}>
                        {shizukuRequesting ? '…' : 'Grant'}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityLabel="Recheck Shizuku"
                    style={({ pressed }) => [styles.permSkip, pressed && styles.permBtnPressed]}
                    onPress={() => void handleRecheckShizuku()}
                    disabled={shizukuChecking}
                  >
                    <Text style={styles.permSkipText}>
                      {shizukuChecking ? '…' : 'Recheck'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Skip Shizuku"
                    style={({ pressed }) => [styles.permSkip, pressed && styles.permBtnPressed]}
                    onPress={() => {}}
                  >
                    <Text style={styles.permSkipText}>Not now</Text>
                  </Pressable>
                </View>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                onPress={() => void handleFinishSetup()}
              >
                <Text style={styles.buttonText}>Finish setup</Text>
              </Pressable>
            </View>
          )}

        </ScrollView>

        <AccessibilityGuide visible={guideVisible} onClose={() => setGuideVisible(false)} />
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}
