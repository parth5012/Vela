import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  Text,
  View,
} from 'react-native';
import { useOfflineStore, SyncState } from '../../store/useOfflineStore';
import { useConfigStore } from '../../store/useConfigStore';
import { getAurora } from '../../utils/theme';
import { healthProbeManager } from '../../utils/healthProbe';
import { flushPendingMessages } from '../../utils/offlineSync';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function SyncStatusIndicator() {
  const syncState = useOfflineStore((state) => state.syncState);
  const isChecking = useOfflineStore((state) => state.isChecking);
  const pendingQueueCount = useOfflineStore((state) => state.pendingQueueCount);

  // Granular store subscriptions to avoid re-renders on unrelated config changes
  const apiUrl = useConfigStore((state) => state.apiUrl);
  const isConfigured = useConfigStore((state) => state.isConfigured);
  const theme = useConfigStore((state) => state.theme);
  const accentColor = useConfigStore((state) => state.accentColor);

  const aurora = getAurora(accentColor, theme);
  const reducedMotion = useReducedMotion();

  const pressScale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const prevSyncState = useRef(syncState);

  useEffect(() => {
    if (prevSyncState.current !== syncState) {
      prevSyncState.current = syncState;

      // When syncing or checking, ActivityIndicator replaces the dot; skip pulsing the unmounted dot
      if (syncState === 'syncing') {
        pulseScale.setValue(1);
        pulseOpacity.setValue(1);
        return;
      }

      let anim: Animated.CompositeAnimation;
      if (!reducedMotion) {
        anim = Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseScale, {
              toValue: 1.25,
              duration: DURATIONS.press,
              easing: EASING.out,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 0.6,
              duration: DURATIONS.press,
              easing: EASING.out,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(pulseScale, {
              toValue: 1,
              duration: DURATIONS.reveal,
              easing: EASING.out,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 1,
              duration: DURATIONS.reveal,
              easing: EASING.out,
              useNativeDriver: true,
            }),
          ]),
        ]);
      } else {
        anim = Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: 0.5,
            duration: DURATIONS.press,
            easing: EASING.out,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 1,
            duration: DURATIONS.reveal,
            easing: EASING.out,
            useNativeDriver: true,
          }),
        ]);
      }
      anim.start();
      // Stopping an Animated.Value leaves it at its current value; reset so an
      // interrupted pulse cannot leave the dot enlarged/dimmed when the next
      // effect run skips animation (prevSyncState already matches syncState).
      return () => {
        anim.stop();
        pulseScale.setValue(1);
        pulseOpacity.setValue(1);
      };
    }
  }, [syncState, reducedMotion, pulseScale, pulseOpacity]);

  const handlePressIn = () => {
    if (!reducedMotion) {
      Animated.timing(pressScale, {
        toValue: 0.95,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(pressOpacity, {
        toValue: 0.6,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      Animated.timing(pressScale, {
        toValue: 1,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(pressOpacity, {
        toValue: 1,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    }
  };

  const handlePress = () => {
    let title = 'Sync Status';
    let message = '';

    if (!isConfigured || !apiUrl) {
      Alert.alert(
        title,
        'Vela node is not configured yet. Please configure it in Settings.'
      );
      return;
    }

    const cleanUrl = apiUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    switch (syncState) {
      case 'online':
        message =
          pendingQueueCount > 0
            ? `✓ Connected.\n\nNode: ${cleanUrl}\nPending queue: ${pendingQueueCount} items queued for sync.`
            : `✓ Connected and synced.\n\nNode: ${cleanUrl}\nPending queue: 0 items`;
        break;
      case 'syncing':
        message = `Syncing changes with backend...\n\nNode: ${cleanUrl}\nPending queue: ${pendingQueueCount} items`;
        break;
      case 'offline':
        message = `⚠️ Offline - backend unreachable.\n\nNode: ${cleanUrl}\nPending queue: ${pendingQueueCount} items queued for sync.`;
        break;
      case 'error':
        message = `❌ Sync encountered an error.\n\nNode: ${cleanUrl}\nPending queue: ${pendingQueueCount} items queued for retry.`;
        break;
    }

    Alert.alert(title, message, [
      { text: 'OK', style: 'cancel' },
      {
        text: 'Sync Now',
        onPress: () => {
          healthProbeManager.executeProbe();
          void flushPendingMessages();
        },
      },
    ]);
  };

  const getStatusDotStyle = (state: SyncState) => {
    switch (state) {
      case 'online':
        return styles.dotOnline;
      case 'syncing':
        return styles.dotSyncing;
      case 'offline':
        return styles.dotOffline;
      case 'error':
        return styles.dotError;
      default:
        return styles.dotUnknown;
    }
  };

  const accessibilityLabel = `Sync status: ${syncState}${
    pendingQueueCount > 0 ? `, ${pendingQueueCount} pending` : ''
  }`;

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.container,
        { transform: [{ scale: pressScale }], opacity: pressOpacity },
      ]}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Displays sync connection details and allows triggering manual sync"
      accessibilityState={{ busy: isChecking || syncState === 'syncing' }}
      testID="sync-status-indicator"
    >
      <View style={styles.chipRow}>
        {isChecking || syncState === 'syncing' ? (
          <ActivityIndicator size="small" color={aurora.acc1} style={styles.loader} />
        ) : (
          <Animated.View
            style={[
              styles.dot,
              getStatusDotStyle(syncState),
              { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
            ]}
          />
        )}
        <Text style={[styles.syncText, { color: syncState === 'online' ? '#047857' : '#6B7280' }]}>
          {syncState === 'online' ? 'Online' : syncState === 'syncing' ? 'Sync' : 'Offline'}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  syncText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  loader: {
    width: 8,
    height: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  dotOffline: {
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  dotSyncing: {
    backgroundColor: '#f59e0b',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  dotError: {
    backgroundColor: '#f43f5e',
    shadowColor: '#f43f5e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  dotUnknown: {
    backgroundColor: '#71717a',
  },
});

export default React.memo(SyncStatusIndicator);
