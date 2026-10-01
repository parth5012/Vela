import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import DeviceAgentNative from '../../modules/device-agent';
import {
  SHIZUKU_TOOLS,
  deriveShizukuState,
  describeShizukuState,
  ShizukuState,
  ShizukuStatus,
} from '../../utils/shizuku';
import { classifyAction, getCategoryLabel } from '../../utils/safetyManager';
import { AuroraScreen, Card, Label, PrimaryButton, useAurora } from '../../components/ui/settingsKit';

const SHIZUKU_PLAY_STORE = 'https://play.google.com/store/apps/details?id=moe.shizuku.manager';
const SHIZUKU_DOWNLOADS = 'https://shizuku.rikka.app/download/';

const STATE_TONE: Record<ShizukuState | 'unknown', string> = {
  ready: '#34D399',
  permission_denied: '#FBBF24',
  server_stopped: '#FBBF24',
  app_missing: '#F87171',
  unknown: '#9CA3AF',
};

const STATE_TITLE: Record<ShizukuState | 'unknown', string> = {
  ready: 'Connected',
  permission_denied: 'Permission not granted',
  server_stopped: 'Server not running',
  app_missing: 'Shizuku not installed',
  unknown: 'Status unavailable',
};

/** One-line capability rows: what Vela may do through Shizuku, and its tier. */
const CAPABILITIES = SHIZUKU_TOOLS.map((tool) => ({
  tool,
  tier: getCategoryLabel(classifyAction(tool, 'com.example.app', 'value')),
}));

const STEPS: { title: string; body: string }[] = [
  {
    title: '1. Install Shizuku',
    body: 'Get it from Play Store, F-Droid, or shizuku.rikka.app/download. Open the app once so it registers itself.',
  },
  {
    title: '2. Enable Developer options',
    body: 'Settings → About phone → tap "Build number" seven times, then open Settings → System → Developer options.',
  },
  {
    title: '3. Turn on Wireless debugging',
    body: 'In Developer options, enable "Wireless debugging". On Android 11 and newer no computer is needed.',
  },
  {
    title: '4. Start Shizuku',
    body: 'In the Shizuku app tap Start, then pair using the pairing code shown under Wireless debugging → "Pair device with pairing code". Shizuku shows "Shizuku is running".',
  },
  {
    title: '5. Grant Vela permission',
    body: 'Come back here and tap "Request permission" below, then Allow in the Shizuku dialog.',
  },
];

export default function ShizukuSetupScreen() {
  const { colors, sizes } = useAurora();
  const [status, setStatus] = useState<ShizukuStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestResult, setRequestResult] = useState<string | null>(null);

  const nativeAvailable = !!(DeviceAgentNative && DeviceAgentNative.getShizukuStatus);

  const refresh = useCallback(async () => {
    if (!nativeAvailable) {
      setStatus(null);
      return;
    }
    setChecking(true);
    try {
      setStatus(await DeviceAgentNative.getShizukuStatus());
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, [nativeAvailable]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const state: ShizukuState | 'unknown' = status ? deriveShizukuState(status) : 'unknown';

  const handleRequestPermission = async () => {
    if (!DeviceAgentNative?.requestShizukuPermission) return;
    setRequesting(true);
    setRequestResult(null);
    try {
      const result = await DeviceAgentNative.requestShizukuPermission();
      setRequestResult(result);
    } catch (e: any) {
      setRequestResult(`failed: ${e?.message || e}`);
    } finally {
      setRequesting(false);
      refresh();
    }
  };

  const renderStatusBody = () => {
    if (!nativeAvailable) {
      return (
        <Text style={[styles.body, { color: colors.textMuted, fontSize: sizes.sub }]}>
          The device agent native module is not available in this build, so Vela cannot talk to
          Shizuku. Build the Android app (npm run android) to enable it.
        </Text>
      );
    }
    return (
      <>
        <Text style={[styles.body, { color: colors.textMuted, fontSize: sizes.sub }]}>
          {status
            ? describeShizukuState(state as ShizukuState)
            : checking
              ? 'Reading Shizuku status…'
              : 'Could not read Shizuku status. Tap Recheck status.'}
        </Text>
        {status && status.serverRunning && status.uid >= 0 ? (
          <Text style={[styles.body, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Server privilege:{' '}
            {status.uid === 0 ? 'root (uid 0)' : status.uid === 2000 ? 'ADB / shell (uid 2000)' : `uid ${status.uid}`}
          </Text>
        ) : null}

        {state === 'app_missing' ? (
          <View style={styles.buttons}>
            <PrimaryButton
              label="Install Shizuku"
              onPress={() => Linking.openURL(SHIZUKU_PLAY_STORE).catch(() => Linking.openURL(SHIZUKU_DOWNLOADS))}
            />
          </View>
        ) : null}

        {state === 'permission_denied' ? (
          <View style={styles.buttons}>
            <PrimaryButton
              label="Request permission"
              loading={requesting}
              onPress={handleRequestPermission}
            />
            {requestResult ? (
              <Text style={[styles.result, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
                Last request: {requestResult}
                {requestResult === 'denied_permanently'
                  ? ' — open the Shizuku app and allow Vela manually (denied twice).'
                  : ''}
                {requestResult === 'server_stopped'
                  ? ' — start Shizuku first (step 4).'
                  : ''}
              </Text>
            ) : null}
          </View>
        ) : null}

        {state === 'server_stopped' || state === 'unknown' ? (
          <View style={styles.buttons}>
            <PrimaryButton label={checking ? 'Checking…' : 'Recheck status'} loading={checking} onPress={refresh} />
          </View>
        ) : null}

        {state === 'ready' ? (
          <View style={styles.buttons}>
            <PrimaryButton label="Recheck" loading={checking} onPress={refresh} />
          </View>
        ) : null}
      </>
    );
  };

  return (
    <AuroraScreen
      title="Shizuku Setup"
      subtitle="Connect Vela to Shizuku so the agent can run privileged, allowlisted device operations."
    >
      <Card style={styles.card}>
        <View style={styles.statusRow}>
          <View
            style={[styles.dot, { backgroundColor: STATE_TONE[state] }]}
            accessibilityLabel={`Shizuku status: ${STATE_TITLE[state]}`}
          />
          <Label>{STATE_TITLE[state]}</Label>
        </View>
        {renderStatusBody()}
      </Card>

      <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.sub + 2 }]}>
        Setup guide
      </Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
        Non-rooted phones restart Shizuku after every reboot — repeat step 4 when the server stops.
        Rooted phones can start Shizuku on boot from inside the Shizuku app.
      </Text>
      {STEPS.map((step) => (
        <Card key={step.title} style={styles.card}>
          <Label>{step.title}</Label>
          <Text style={[styles.body, { color: colors.textMuted, fontSize: sizes.sub }]}>
            {step.body}
          </Text>
        </Card>
      ))}

      <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.sub + 2 }]}>
        What Vela can do through Shizuku
      </Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
        Exactly these eight operations — no other shell access. Each is still governed by your
        Device Agent Permissions tier, which stays Blocked by default for Root & Shizuku
        Operations.
      </Text>
      {CAPABILITIES.map((cap) => (
        <Card key={cap.tool} style={styles.card}>
          <Label>{cap.tool}</Label>
          <Text style={[styles.body, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Policy tier: {cap.tier}
          </Text>
        </Card>
      ))}
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    padding: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  body: {
    lineHeight: 18,
  },
  result: {
    marginTop: 8,
    lineHeight: 16,
  },
  buttons: {
    marginTop: 12,
  },
  sectionTitle: {
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sectionSubtitle: {
    marginBottom: 12,
    paddingHorizontal: 4,
    lineHeight: 16,
  },
});
