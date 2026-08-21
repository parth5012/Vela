import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, AppState, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { AuroraScreen, Card, useAurora, PrimaryButton } from '../../components/ui/settingsKit';
import {
  APP_PERMISSIONS,
  checkPermission,
  requestPermission,
  openSettings,
  getRationale,
  type OSPermission,
  type PermissionStatus,
} from '../../utils/permissionManager';
import { useConfigStore } from '../../store/useConfigStore';

function StatusPill({
  status,
  colors,
  sizes,
}: {
  status: PermissionStatus;
  colors: ReturnType<typeof useAurora>['colors'];
  sizes: ReturnType<typeof useAurora>['sizes'];
}) {
  const bg =
    status === 'granted'
      ? 'rgba(34,197,94,0.18)'
      : status === 'denied'
        ? 'rgba(239,68,68,0.18)'
        : 'rgba(115,115,130,0.18)';
  const border =
    status === 'granted'
      ? 'rgba(34,197,94,0.35)'
      : status === 'denied'
        ? 'rgba(239,68,68,0.35)'
        : 'rgba(115,115,130,0.25)';
  const textColor =
    status === 'granted' ? '#22c55e' : status === 'denied' ? '#f87171' : colors.textMuted;
  const label = status === 'granted' ? 'Granted' : status === 'denied' ? 'Denied' : 'Not set';

  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
      <View
        style={[
          styles.pillDot,
          {
            backgroundColor: status === 'granted' ? '#22c55e' : status === 'denied' ? '#ef4444' : colors.textDark,
          },
        ]}
      />
      <Text style={{ color: textColor, fontSize: sizes.sub, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export default function PermissionsHubScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();
  const setOSPermission = useConfigStore((s) => s.setOSPermission);
  const resetAgentTiers = useCallback(() => {
    const store = useConfigStore.getState();
    // Reset to defaults matching initial state in useConfigStore
    const defaults: Record<string, 'auto' | 'confirm' | 'deny'> = {
      screen_read: 'auto',
      info: 'auto',
      screenshot: 'auto',
      open_app: 'auto',
      scroll: 'auto',
      swipe: 'auto',
      press_key: 'auto',
      set_volume: 'auto',
      type: 'auto',
      tap: 'auto',
      send_communication: 'confirm',
      calls: 'confirm',
      purchases: 'confirm',
      deletions: 'confirm',
      settings_changes: 'confirm',
      play_installs: 'confirm',
      passwords_otps: 'deny',
      sideloads: 'deny',
      permission_toggles: 'deny',
      root_shizuku: 'deny',
    };
    Object.entries(defaults).forEach(([k, v]) => {
      store.setDeviceAgentPermission(k as never, v as never);
    });
  }, []);

  const [statuses, setStatuses] = useState<Record<OSPermission, PermissionStatus>>({
    notifications: 'undetermined',
    camera: 'undetermined',
    microphone: 'undetermined',
    storage: 'granted',
    accessibility: 'undetermined',
    background: 'undetermined',
  });
  const [loadingPerm, setLoadingPerm] = useState<OSPermission | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const refreshAll = useCallback(async () => {
    const next: Record<OSPermission, PermissionStatus> = {} as Record<OSPermission, PermissionStatus>;
    for (const meta of APP_PERMISSIONS) {
      const s = await checkPermission(meta.perm);
      next[meta.perm] = s;
      setOSPermission(meta.perm, s);
    }
    setStatuses((prev) => ({ ...prev, ...next }));
  }, [setOSPermission]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshAll();
      }
    });
    return () => sub.remove();
  }, [refreshAll]);

  const handleManage = useCallback(
    async (perm: OSPermission) => {
      setLoadingPerm(perm);
      try {
        const current = statuses[perm];
        if (current === 'undetermined') {
          const result = await requestPermission(perm);
          setStatuses((prev) => ({ ...prev, [perm]: result }));
          setOSPermission(perm, result);
          if (result === 'undetermined' || result === 'denied') {
            // If request didn't resolve, offer settings
            await openSettings(perm);
          }
        } else {
          await openSettings(perm);
        }
      } finally {
        setLoadingPerm(null);
      }
    },
    [statuses, setOSPermission]
  );

  const handleGrantAll = useCallback(async () => {
    setBulkLoading(true);
    try {
      for (const meta of APP_PERMISSIONS) {
        // Skip already granted
        if (statuses[meta.perm] === 'granted') continue;
        // Only prompt for requestable perms; accessibility will open settings and break loop
        if (meta.perm === 'accessibility' || meta.perm === 'storage' || meta.perm === 'background') {
          continue;
        }
        const result = await requestPermission(meta.perm);
        setStatuses((prev) => ({ ...prev, [meta.perm]: result }));
        setOSPermission(meta.perm, result);
      }
    } finally {
      setBulkLoading(false);
      // Refresh to capture any settings changes
      refreshAll();
    }
  }, [statuses, setOSPermission, refreshAll]);

  const handleResetTiers = useCallback(() => {
    Alert.alert('Reset Agent Tiers', 'Reset all Device Agent permissions to defaults?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          resetAgentTiers();
          Alert.alert('Done', 'Agent tiers reset to defaults.');
        },
      },
    ]);
  }, [resetAgentTiers]);

  return (
    <AuroraScreen title="Permissions" onBack={() => router.back()}>
      {/* App Permissions Section */}
      <View>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.sub + 2 }]}>
          App Permissions
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
          Control what Vela can access on this device. Privacy-first: nothing is shared to the backend.
        </Text>

        {APP_PERMISSIONS.map((meta) => {
          const status = statuses[meta.perm];
          const isLoading = loadingPerm === meta.perm;
          return (
            <Card key={meta.perm} style={styles.card}>
              <View style={styles.rowHeader}>
                <View style={[styles.iconCircle, { borderColor: colors.glassBorder }]}>
                  <Text style={{ fontSize: sizes.text + 2 }}>{meta.icon}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowLabel, { color: colors.text, fontSize: sizes.text }]}>{meta.label}</Text>
                  <Text style={[styles.rowHint, { color: colors.textMuted, fontSize: sizes.sub }]}>
                    {meta.description}
                  </Text>
                  <Text style={[styles.rationale, { color: colors.textDark, fontSize: sizes.sub - 1 }]}>
                    {getRationale(meta.perm)}
                  </Text>
                </View>
              </View>

              <View style={styles.rowFooter}>
                <StatusPill status={status} colors={colors} sizes={sizes} />
                <Pressable
                  onPress={() => handleManage(meta.perm)}
                  disabled={isLoading}
                  style={({ pressed }) => [
                    styles.manageBtn,
                    {
                      backgroundColor: aurora.acc1,
                      opacity: pressed || isLoading ? 0.7 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${meta.label} permission`}
                >
                  {isLoading ? (
                    <ActivityIndicator color={aurora.onAccent} size="small" />
                  ) : (
                    <Text style={[styles.manageText, { color: aurora.onAccent, fontSize: sizes.sub }]}>
                      Manage
                    </Text>
                  )}
                </Pressable>
              </View>
            </Card>
          );
        })}
      </View>

      {/* Bulk actions */}
      <Card style={styles.bulkCard}>
        <Text style={[styles.bulkTitle, { color: colors.text, fontSize: sizes.text }]}>Bulk actions</Text>
        <PrimaryButton label={bulkLoading ? 'Requesting…' : 'Grant All Required'} onPress={handleGrantAll} loading={bulkLoading} />
        <Pressable
          onPress={handleResetTiers}
          style={({ pressed }) => [styles.resetBtn, { borderColor: colors.glassBorder, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.resetText, { color: colors.textMuted, fontSize: sizes.text }]}>Reset Agent Tiers</Text>
        </Pressable>
      </Card>

      {/* Agent Permissions subsection */}
      <View>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.sub + 2 }]}>
          Agent Permissions
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
          Fine-grained controls for on-device automation. Configure which actions run automatically, ask, or stay blocked.
        </Text>
        <Card style={styles.agentCard}>
          <View style={styles.agentHeader}>
            <Text style={{ fontSize: sizes.text + 4 }}>🛡️</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text, fontSize: sizes.text }]}>Device Agent Permissions</Text>
              <Text style={[styles.rowHint, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Auto / Ask / Blocked safety tiers
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/settings/device-agent' as never)}
            style={({ pressed }) => [
              styles.deviceAgentBtn,
              { borderColor: aurora.acc1, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open Device Agent permissions"
          >
            <Text style={[styles.deviceAgentBtnText, { color: aurora.acc1, fontSize: sizes.text }]}>Open Device Agent →</Text>
          </Pressable>
        </Card>
      </View>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sectionSubtitle: {
    marginBottom: 12,
    paddingHorizontal: 4,
    lineHeight: 16,
  },
  card: {
    marginBottom: 12,
    padding: 14,
    gap: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontWeight: '600',
  },
  rowHint: {
    marginTop: 1,
  },
  rationale: {
    marginTop: 6,
    lineHeight: 14,
    fontStyle: 'italic',
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  manageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageText: {
    fontWeight: '700',
  },
  bulkCard: {
    gap: 12,
  },
  bulkTitle: {
    fontWeight: '700',
  },
  resetBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  resetText: {
    fontWeight: '600',
  },
  agentCard: {
    gap: 14,
    padding: 14,
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deviceAgentBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceAgentBtnText: {
    fontWeight: '600',
  },
});
