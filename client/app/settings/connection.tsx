import React, { useState } from 'react';
import { Text, Keyboard } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import { syncHistoryWithBackend } from '../../utils/history';
import GoogleWorkspaceCard from '../../components/ui/GoogleWorkspaceCard';
import { AuroraScreen, Card, Field, PrimaryButton, Label, useAurora } from '../../components/ui/settingsKit';

export default function ConnectionScreen() {
  const apiUrl = useConfigStore((s) => s.apiUrl);
  const apiKey = useConfigStore((s) => s.apiKey);
  const setConfig = useConfigStore((s) => s.setConfig);
  const { colors, sizes, aurora } = useAurora();

  const [url, setUrl] = useState(apiUrl);
  const [key, setKey] = useState(apiKey);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

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
      title="Server & API Key"
      subtitle="The remote endpoint and auth token used to reach your Vela FastAPI node."
    >
      <Card>
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
    </AuroraScreen>
  );
}
