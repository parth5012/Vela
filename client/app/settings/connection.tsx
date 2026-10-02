import React, { useState, useEffect, useCallback } from 'react';
import { Text, Keyboard, View, Switch, Pressable, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useConfigStore, ConnectionMode } from '../../store/useConfigStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import { syncHistoryWithBackend } from '../../utils/history';
import { getAllCookies, clearAll } from '../../utils/cookieSync';
import GoogleWorkspaceCard from '../../components/ui/GoogleWorkspaceCard';
import {
  AuroraScreen,
  Card,
  Field,
  PrimaryButton,
  SecondaryButton,
  Label,
  PillGroup,
  useAurora,
} from '../../components/ui/settingsKit';

const MODE_OPTIONS = [
  { value: 'server' as const, label: '🖥️ Server' },
  { value: 'local' as const, label: '🤖 Local AI' },
  { value: 'cloud' as const, label: '☁️ Cloud APIs' },
];

export default function ConnectionScreen() {
  const router = useRouter();
  const connectionMode = useConfigStore((s) => s.connectionMode);
  const setConnectionMode = useConfigStore((s) => s.setConnectionMode);
  const activeCloudProvider = useConfigStore((s) => s.activeCloudProvider);
  const localModelName = useConfigStore((s) => s.localModelName);
  const apiUrl = useConfigStore((s) => s.apiUrl);
  const apiKey = useConfigStore((s) => s.apiKey);
  const setConfig = useConfigStore((s) => s.setConfig);
  const { colors, sizes, aurora } = useAurora();

  const [url, setUrl] = useState(apiUrl);
  const [key, setKey] = useState(apiKey);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerCookies, setViewerCookies] = useState<Record<string, Record<string, unknown>> | null>(null);
  const cookieSyncDomains = useBrowserStore((s) => s.cookieSyncDomains);
  const lastCookieSync = useBrowserStore((s) => s.lastCookieSync);
  const cookieSyncStatus = useBrowserStore((s) => s.cookieSyncStatus);

  useEffect(() => {
    AsyncStorage.getItem('cookie_auto_sync').then((v) => {
      if (v !== null) setAutoSync(v === 'true');
    });
  }, []);

  const toggleAutoSync = async (value: boolean) => {
    setAutoSync(value);
    await AsyncStorage.setItem('cookie_auto_sync', value ? 'true' : 'false');
  };

  const handleToggleViewer = useCallback(async () => {
    const next = !viewerExpanded;
    setViewerExpanded(next);
    if (next) {
      setViewerLoading(true);
      try {
        const all = await getAllCookies();
        setViewerCookies(all);
      } catch {
        setViewerCookies({});
      } finally {
        setViewerLoading(false);
      }
    }
  }, [viewerExpanded]);

  const handleClearCookies = useCallback(async () => {
    const ok = await clearAll();
    if (ok) {
      useBrowserStore.getState().setCookieSyncStatus('idle');
      useBrowserStore.getState().setLastCookieSync(null);
      useBrowserStore.getState().setCookieSyncDomains([]);
      setViewerCookies({});
    }
  }, []);

  const handleSave = async () => {
    Keyboard.dismiss();
    setSuccess(false);

    if (!url.trim()) {
      setError('API URL is required');
      return;
    }
    if (!key.trim()) {
      setError('API Key is required');
      return;
    }

    let formattedUrl = url.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }
    formattedUrl = formattedUrl.replace(/\/+$/, '');

    try {
      setIsTesting(true);
      setError('');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${formattedUrl}/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        setConfig(formattedUrl, key.trim());
        setSuccess(true);
        syncHistoryWithBackend(formattedUrl, key.trim());
      } else {
        setError(`Connection failed. Server returned status: ${response.status}`);
      }
    } catch (err: any) {
      setSuccess(false);
      if (err.name === 'AbortError') {
        setError('Connection timed out. Please verify your URL and network.');
      } else {
        setError(err.message || 'Failed to connect. Please check URL and credentials.');
      }
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <AuroraScreen
      title="Connection & Mode"
      subtitle="Configure how Vela connects: self-hosted backend server, on-device local AI, or direct cloud APIs."
    >
      <Card>
        <Label>Connection Mode</Label>
        <PillGroup
          options={MODE_OPTIONS}
          value={connectionMode}
          onChange={(m) => setConnectionMode(m as ConnectionMode)}
        />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 8 }}>
          {connectionMode === 'server'
            ? 'Backend Server: Connects to your self-hosted Vela backend for synchronization and agent tools.'
            : connectionMode === 'local'
            ? 'Local AI: Runs GGUF / LiteRT on-device inference entirely offline with zero data leaving your phone.'
            : 'Cloud APIs: Calls Google Gemini, OpenAI, Anthropic, OpenRouter, or Groq directly via Vercel AI SDK.'}
        </Text>
      </Card>

      {connectionMode === 'cloud' && (
        <Card style={{ borderColor: aurora.acc1, borderWidth: 1 }}>
          <Label>Direct Cloud Providers</Label>
          <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '700', marginBottom: 4 }}>
            Active Provider: {(activeCloudProvider || 'gemini').toUpperCase()}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 16 }}>
            Direct device-to-cloud streaming via Vercel AI SDK. All thread and message data remains securely stored in local SQLite.
          </Text>
          <PrimaryButton
            label="Configure Cloud Providers"
            onPress={() => router.push('/settings/cloud-providers' as any)}
          />
        </Card>
      )}

      {connectionMode === 'local' && (
        <Card style={{ borderColor: aurora.acc1, borderWidth: 1 }}>
          <Label>On-Device Inference</Label>
          <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '700', marginBottom: 4 }}>
            Active Model: {localModelName || 'None selected'}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginBottom: 16 }}>
            On-device inference with RAM detection, GGUF/LiteRT model downloads, and zero network calls.
          </Text>
          <PrimaryButton
            label="Configure Local Models"
            onPress={() => router.push('/settings/local-ai' as any)}
          />
        </Card>
      )}

      <Card>
        <Label>{connectionMode === 'server' ? 'Server Credentials' : 'Server Settings (Optional in Standalone)'}</Label>
        <Field
          label="Server URL"
          placeholder="https://api.vela.local"
          value={url}
          onChangeText={(t) => {
            setUrl(t);
            if (error) setError('');
            if (success) setSuccess(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Field
          label="API Access Key"
          placeholder="Enter your API access token"
          value={key}
          onChangeText={(t) => {
            setKey(t);
            if (error) setError('');
            if (success) setSuccess(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        {error ? <Text style={{ color: '#f87171', fontSize: sizes.sub, textAlign: 'center' }}>{error}</Text> : null}
        {success ? (
          <Text style={{ color: '#34d399', fontSize: sizes.sub, textAlign: 'center', fontWeight: '500' }}>
            ✓ Settings saved successfully!
          </Text>
        ) : null}

        <PrimaryButton
          label="Save & Test Connection"
          onPress={handleSave}
          loading={isTesting}
          disabled={isTesting}
        />
      </Card>

      <Card>
        <Label>Google Workspace</Label>
        <GoogleWorkspaceCard
          colors={{
            background: colors.background,
            card: colors.card,
            border: colors.border,
            text: colors.text,
            textMuted: colors.textMuted,
            textDark: colors.textDark,
          }}
          sizes={sizes}
          accentHex={aurora.acc1}
        />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
              Auto-import cookies on launch
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 16 }}>
              When enabled, Vela will re-import cookies from the last selected file when the app starts. Cookies stay on-device.
            </Text>
          </View>
          <Switch
            value={autoSync}
            onValueChange={toggleAutoSync}
            trackColor={{ false: colors.border, true: aurora.acc1 + '80' }}
            thumbColor={autoSync ? aurora.acc1 : colors.textMuted}
            accessibilityLabel="Auto-import cookies on launch"
          />
        </View>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>🍪 Cookie Sync</Text>
            <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 16 }}>
              {lastCookieSync
                ? `Last synced: ${new Date(lastCookieSync).toLocaleString()} • ${cookieSyncStatus} • ${cookieSyncDomains.length} domains`
                : 'No cookies synced yet. Import from Browser.'}
            </Text>
            {cookieSyncDomains.length > 0 ? (
              <Text style={{ color: colors.textDark, fontSize: sizes.sub }} numberOfLines={2}>
                {cookieSyncDomains.join(', ')}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={handleToggleViewer}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.border : colors.background,
              marginLeft: 12,
            })}
            accessibilityLabel="Toggle cookie viewer"
          >
            <Text style={{ color: colors.text, fontSize: sizes.sub, fontWeight: '600' }}>
              {viewerExpanded ? 'Hide' : 'View'}
            </Text>
          </Pressable>
        </View>

        {viewerExpanded ? (
          <View style={{ marginTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
            {viewerLoading ? (
              <ActivityIndicator color={aurora.acc1} />
            ) : viewerCookies && Object.keys(viewerCookies).length > 0 ? (
              <>
                <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>
                  {Object.keys(viewerCookies).length} domains in WebView • tap Clear to remove all
                </Text>
                {Object.entries(viewerCookies)
                  .slice(0, 20)
                  .map(([domain, cookies]) => (
                    <View
                      key={domain}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <Text style={{ color: colors.text, fontSize: sizes.text, flex: 1 }} numberOfLines={1}>
                        {domain}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginLeft: 12 }}>
                        {Object.keys(cookies as object).length} cookies
                      </Text>
                    </View>
                  ))}
                <Pressable
                  onPress={handleClearCookies}
                  style={({ pressed }) => ({
                    marginTop: 8,
                    paddingVertical: 10,
                    borderRadius: 8,
                    alignItems: 'center',
                    backgroundColor: pressed ? '#ef4444cc' : '#ef4444',
                  })}
                  accessibilityLabel="Clear all cookies"
                >
                  <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: sizes.text }}>Clear All Cookies</Text>
                </Pressable>
              </>
            ) : cookieSyncDomains.length > 0 ? (
              <View style={{ gap: 8 }}>
                {cookieSyncDomains.map((d) => (
                  <View
                    key={d}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: sizes.text }}>{d}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>synced</Text>
                  </View>
                ))}
                <Pressable
                  onPress={handleClearCookies}
                  style={({ pressed }) => ({
                    marginTop: 8,
                    paddingVertical: 10,
                    borderRadius: 8,
                    alignItems: 'center',
                    backgroundColor: pressed ? '#ef4444cc' : '#ef4444',
                  })}
                  accessibilityLabel="Clear all cookies"
                >
                  <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: sizes.text }}>Clear All Cookies</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: sizes.sub, textAlign: 'center' }}>
                No cookies stored. Import via Browser → Cookie Sync.
              </Text>
            )}
          </View>
        ) : null}
      </Card>
    </AuroraScreen>
  );
}
