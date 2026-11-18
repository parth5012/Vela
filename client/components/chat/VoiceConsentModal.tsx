import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useAurora } from '../../hooks/useAurora';

export interface VoiceConsentModalProps {
  visible: boolean;
  provider: string;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * WF-583: per-recording, explicit consent before any audio leaves the device.
 * Only shown after on-device transcription fails and a supported cloud
 * provider is configured.
 */
export default function VoiceConsentModal({
  visible,
  provider,
  onAccept,
  onDecline,
}: VoiceConsentModalProps) {
  const { colors, sizes, aurora } = useAurora();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.glassBorder }]}>
          <Text style={[styles.title, { color: colors.text, fontSize: sizes.title }]}>
            Send audio to {provider}?
          </Text>
          <Text style={[styles.body, { color: colors.textMuted, fontSize: sizes.text }]}>
            On-device transcription did not work for this recording. To try {provider}, the
            recorded audio must leave your device and be sent over the internet. Nothing is sent
            unless you agree.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onDecline}
              accessibilityRole="button"
              accessibilityLabel="Do not send audio"
              style={({ pressed }) => [
                styles.button,
                styles.secondary,
                { borderColor: colors.glassBorder, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>Don&apos;t send</Text>
            </Pressable>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel={`Send audio to ${provider}`}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: aurora.acc1, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.buttonText, { color: aurora.onAccent }]}>Send to {provider}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  title: {
    fontWeight: '700',
  },
  body: {
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    borderWidth: 1,
  },
  buttonText: {
    fontWeight: '700',
  },
});
