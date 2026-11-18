import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAurora } from '../../hooks/useAurora';
import { formatElapsed } from '../../utils/transcription/waveform';

export interface VoiceRecordingBarProps {
  elapsedMs: number;
  levels: number[];
  partialText?: string;
  onCancel: () => void;
}

/** WF-583: live recording indicator with elapsed time, waveform and cancel. */
export default function VoiceRecordingBar({
  elapsedMs,
  levels,
  partialText,
  onCancel,
}: VoiceRecordingBarProps) {
  const { colors, sizes, aurora } = useAurora();
  const clock = formatElapsed(elapsedMs);

  return (
    <View
      style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.glassBorder }]}
      accessibilityRole="timer"
      accessibilityLabel={`Recording, ${clock}`}
    >
      <View style={styles.left}>
        <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
        <Text style={[styles.time, { color: colors.text }]}>{clock}</Text>
      </View>
      <View style={styles.wave} accessibilityElementsHidden>
        {levels.map((level, i) => (
          <View
            key={i}
            style={[
              styles.level,
              { height: 4 + level * 20, backgroundColor: aurora.acc1, opacity: 0.45 + level * 0.55 },
            ]}
          />
        ))}
      </View>
      {partialText ? (
        <Text numberOfLines={1} style={[styles.partial, { color: colors.textMuted, fontSize: sizes.sub }]}>
          {partialText}
        </Text>
      ) : null}
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel recording"
        style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
      >
        <Text style={[styles.cancelText, { color: colors.text, fontSize: sizes.sub }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 60,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  time: {
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  wave: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 26,
  },
  level: {
    width: 3,
    borderRadius: 2,
  },
  partial: {
    maxWidth: 90,
  },
  cancel: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cancelText: {
    fontWeight: '600',
  },
});
