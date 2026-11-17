import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, StyleSheet } from 'react-native';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useConfigStore } from '../../store/useConfigStore';
import { flushPendingMessages } from '../../utils/offlineSync';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function QueueBadge() {
  const pendingQueueCount = useOfflineStore((state) => state.pendingQueueCount);
  const syncState = useOfflineStore((state) => state.syncState);
  const theme = useConfigStore((state) => state.theme);
  const reducedMotion = useReducedMotion();

  const isDark = theme === 'noir';
  const isSyncing = syncState === 'syncing';

  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(pendingQueueCount);

  // Syncing state opacity control
  useEffect(() => {
    if (isSyncing) {
      opacity.setValue(0.4);
      scale.setValue(1);
    } else {
      opacity.setValue(1);
    }
  }, [isSyncing, opacity, scale]);

  // Pulse animation on queue count update (skipped while syncing so the
  // count feedback cannot leave the disabled badge fully opaque)
  useEffect(() => {
    if (isSyncing) return;
    if (pendingQueueCount > 0 && pendingQueueCount !== prevCount.current) {
      prevCount.current = pendingQueueCount;
      let anim: Animated.CompositeAnimation;
      if (!reducedMotion) {
        anim = Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.1,
            duration: DURATIONS.press,
            easing: EASING.out,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: DURATIONS.reveal,
            easing: EASING.out,
            useNativeDriver: true,
          }),
        ]);
      } else {
        anim = Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.7,
            duration: DURATIONS.press,
            easing: EASING.out,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: DURATIONS.reveal,
            easing: EASING.out,
            useNativeDriver: true,
          }),
        ]);
      }
      anim.start();
      return () => anim.stop();
    }
  }, [pendingQueueCount, isSyncing, reducedMotion, scale, opacity]);

  const handlePressIn = () => {
    if (isSyncing) return;
    if (!reducedMotion) {
      Animated.timing(scale, {
        toValue: 0.95,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0.7,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      Animated.timing(scale, {
        toValue: 1,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 1,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    }
  };

  if (pendingQueueCount <= 0) {
    return null;
  }

  const label = `${pendingQueueCount} queued`;
  const accessibilityLabel = `${pendingQueueCount} ${
    pendingQueueCount === 1 ? 'item' : 'items'
  } queued for sync. Tap to sync now.`;

  return (
    <AnimatedPressable
      onPress={() => {
        void flushPendingMessages();
      }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isSyncing}
      style={[
        styles.badge,
        isDark ? styles.badgeDark : styles.badgeLight,
        { transform: [{ scale }], opacity },
      ]}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Attempts to sync queued messages with the server"
      accessibilityState={{ disabled: isSyncing, busy: isSyncing }}
      testID="queue-badge"
    >
      <Text style={[styles.text, isDark ? styles.textDark : styles.textLight]}>
        {label}
      </Text>
    </AnimatedPressable>
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
