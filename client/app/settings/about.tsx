import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
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
  const { colors, sizes, aurora } = useAurora();
  const router = useRouter();

  const [firstVisible, setFirstVisible] = useState(false);
  const [secondVisible, setSecondVisible] = useState(false);

  const handleReset = () => {
    setSecondVisible(false);
    clearConfig();
    clearStore();
    router.replace('/setup');
  };

  const openFirst = () => setFirstVisible(true);
  const confirmFirst = () => {
    setFirstVisible(false);
    setSecondVisible(true);
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const name = Constants.expoConfig?.name ?? 'Vela';

  return (
    <AuroraScreen title="About">
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
        <DangerButton
          label="Reset Server Connection"
          onPress={openFirst}
          accessibilityLabel="Reset Server Connection, requires confirmation"
        />
      </Card>

      {/* First confirm: Are you sure? */}
      <Modal visible={firstVisible} transparent animationType="fade" onRequestClose={() => setFirstVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.glassBorder }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Are you sure?</Text>
            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
              This will erase all local settings, threads, and cached chats. You will return to the setup screen.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel reset"
                onPress={() => setFirstVisible(false)}
                style={({ pressed }) => [
                  styles.modalBtnSecondary,
                  { borderColor: colors.glassBorder, backgroundColor: 'rgba(255,255,255,0.06)' },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue to final confirmation"
                onPress={confirmFirst}
                style={({ pressed }) => [
                  styles.modalBtnPrimary,
                  { backgroundColor: aurora.acc1 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.modalBtnText, { color: aurora.onAccent }]}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Second confirm: destructive final confirmation */}
      <Modal visible={secondVisible} transparent animationType="fade" onRequestClose={() => setSecondVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: 'rgba(239,68,68,0.35)' }]}>
            <Text style={[styles.modalTitle, { color: '#f87171' }]}>Confirm reset</Text>
            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
              This action cannot be undone. All local data will be permanently deleted.
            </Text>
            <Text style={[styles.modalBody, { color: colors.textMuted, fontWeight: '600' }]}>
              Tap Reset to confirm.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel final reset"
                onPress={() => setSecondVisible(false)}
                style={({ pressed }) => [
                  styles.modalBtnSecondary,
                  { borderColor: colors.glassBorder, backgroundColor: 'rgba(255,255,255,0.06)' },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm reset server connection"
                onPress={handleReset}
                style={({ pressed }) => [
                  styles.modalBtnDestructive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Reset</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  modalBtnSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalBtnPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalBtnDestructive: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#ef4444',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.6)',
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
