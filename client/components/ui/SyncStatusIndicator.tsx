import React from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useOfflineStore, SyncState } from '../../store/useOfflineStore';
import { useConfigStore } from '../../store/useConfigStore';
import { getAurora } from '../../utils/theme';
import { healthProbeManager } from '../../utils/healthProbe';
import { flushPendingMessages } from '../../utils/offlineSync';

function SyncStatusIndicator() {
  const syncState = useOfflineStore((state) => state.syncState);
  const isChecking = useOfflineStore((state) => state.isChecking);
  const pendingQueueCount = useOfflineStore((state) => state.pendingQueueCount);
  const { apiUrl, isConfigured, theme, accentColor } = useConfigStore();
  const aurora = getAurora(accentColor, theme);

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
          flushPendingMessages();
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
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.containerPressed,
      ]}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: isChecking || syncState === 'syncing' }}
      testID="sync-status-indicator"
    >
      {isChecking || syncState === 'syncing' ? (
        <ActivityIndicator size="small" color={aurora.acc1} style={styles.loader} />
      ) : (
        <View style={[styles.dot, getStatusDotStyle(syncState)]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  containerPressed: {
    opacity: 0.7,
  },
  loader: {
    width: 10,
    height: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
