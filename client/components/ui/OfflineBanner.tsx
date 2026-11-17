import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useConfigStore } from '../../store/useConfigStore';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export const OFFLINE_BANNER_COPY =
  "You're offline. Changes are saved locally and will sync when reconnected.";

function OfflineBanner() {
  const isOnline = useOfflineStore((state) => state.isOnline);
  const isBackendReachable = useOfflineStore((state) => state.isBackendReachable);
  const syncState = useOfflineStore((state) => state.syncState);
  const theme = useConfigStore((state) => state.theme);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const isOffline = !isOnline || !isBackendReachable || syncState === 'offline';

  const translateY = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOffline) {
      let anim: Animated.CompositeAnimation;
      if (!reducedMotion) {
        anim = Animated.parallel([
          Animated.timing(translateY, {
            toValue: 0,
            duration: DURATIONS.reveal,
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
      } else {
        translateY.setValue(0);
        anim = Animated.timing(opacity, {
          toValue: 1,
          duration: DURATIONS.reveal,
          easing: EASING.out,
          useNativeDriver: true,
        });
      }
      anim.start();
      return () => anim.stop();
    }
  }, [isOffline, reducedMotion, translateY, opacity]);

  if (!isOffline) {
    return null;
  }

  const isDark = theme === 'noir';

  return (
    <Animated.View
      style={[
        styles.container,
        isDark ? styles.containerDark : styles.containerLight,
        {
          paddingTop: Math.max(8, (insets?.top ?? 0) + 4),
          transform: [{ translateY }],
          opacity,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
    >
      <View style={styles.content}>
        <View style={styles.indicatorDot} />
        <Text
          style={[
            styles.text,
            isDark ? styles.textDark : styles.textLight,
          ]}
          numberOfLines={2}
        >
          {OFFLINE_BANNER_COPY}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    zIndex: 9999,
  },
  containerLight: {
    backgroundColor: '#fffbeb',
    borderBottomColor: '#fde68a',
  },
  containerDark: {
    backgroundColor: '#1f1608',
    borderBottomColor: '#452b0d',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
    marginRight: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    textAlign: 'center',
    flexShrink: 1,
  },
  textLight: {
    color: '#92400e',
  },
  textDark: {
    color: '#fde68a',
  },
});

export default React.memo(OfflineBanner);
