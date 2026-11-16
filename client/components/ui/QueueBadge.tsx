import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useConfigStore } from '../../store/useConfigStore';
import { THEME_COLORS } from '../../utils/theme';
import { flushPendingMessages } from '../../utils/offlineSync';

function QueueBadge() {
  const pendingQueueCount = useOfflineStore((state) => state.pendingQueueCount);
  const syncState = useOfflineStore((state) => state.syncState);
  const theme = useConfigStore((state) => state.theme);

  if (pendingQueueCount <= 0) {
    return null;
  }

  const isDark = theme === 'noir';
  const label = `${pendingQueueCount} queued`;
  const accessibilityLabel = `${pendingQueueCount} items queued for sync. Tap to flush.`;

  return (
    <Pressable
      onPress={() => flushPendingMessages()}
      style={({ pressed }) => [
        styles.badge,
        isDark ? styles.badgeDark : styles.badgeLight,
        pressed && styles.badgePressed,
      ]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="queue-badge"
    >
      <Text style={[styles.text, isDark ? styles.textDark : styles.textLight]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  badgeLight: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
  },
  badgeDark: {
    backgroundColor: '#271b05',
    borderColor: '#78350f',
  },
  badgePressed: {
    opacity: 0.7,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  textLight: {
    color: '#b45309',
  },
  textDark: {
    color: '#fbbf24',
  },
});

export default React.memo(QueueBadge);
