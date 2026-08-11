import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useConfigStore } from '../../store/useConfigStore';
import { useChatStore } from '../../store/useChatStore';
import {
  AuroraScreen,
  Card,
  Label,
  DangerButton,
  useAurora,
} from '../../components/ui/settingsKit';

export default function AboutScreen() {
  const clearConfig = useConfigStore((s) => s.clearConfig);
  const clearStore = useChatStore((s) => s.clearStore);
  const { colors, sizes } = useAurora();
  const router = useRouter();

  const handleReset = () => {
    clearConfig();
    clearStore();
    router.replace('/setup');
  };

  const handleResetPress = () => {
    Alert.alert(
      'Reset Server Connection',
      'Are you sure you want to reset your connection? This will erase all local settings, threads, and cached chats.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: handleReset },
      ]
    );
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const name = Constants.expoConfig?.name ?? 'Vela';

  return (
    <AuroraScreen title="About & Danger Zone">
      <Card>
        <Label>Vela</Label>
        <Text style={[styles.line, { color: colors.text, fontSize: sizes.text }]}>
          Your personal AI assistant.
        </Text>
        <Text style={[styles.muted, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Version {version} · {name}
        </Text>
        <Text style={[styles.muted, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Cloud inference via your own self-hosted server, or fully on-device with a
          downloaded LiteRT model.
        </Text>
      </Card>

      <Card style={styles.dangerCard}>
        <Label>Danger Zone</Label>
        <Text style={[styles.muted, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Resetting your connection will erase all local settings, threads, and cached
          chats. You will return to the setup screen.
        </Text>
        <DangerButton label="Reset Server Connection" onPress={handleResetPress} />
      </Card>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  line: {
    marginBottom: 4,
  },
  muted: {
    marginTop: 4,
    lineHeight: 17,
  },
  dangerCard: {
    marginTop: 8,
  },
});
