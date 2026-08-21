import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Card, useAurora } from '../ui/settingsKit';
import type { OSPermission } from '../../utils/permissionManager';

export interface PermissionRequestCardProps {
  permission: OSPermission;
  rationale: string;
  onGrant: () => Promise<void>;
  onDeny: () => void;
  onSuppressChange?: (suppress: boolean) => void;
}

const PERM_LABELS: Record<OSPermission, { icon: string; label: string }> = {
  notifications: { icon: '🔔', label: 'Notifications' },
  camera: { icon: '📷', label: 'Camera' },
  microphone: { icon: '🎙️', label: 'Microphone' },
  storage: { icon: '💾', label: 'Storage' },
  accessibility: { icon: '♿', label: 'Accessibility' },
  background: { icon: '🔄', label: 'Background' },
};

export default function PermissionRequestCard({
  permission,
  rationale,
  onGrant,
  onDeny,
  onSuppressChange,
}: PermissionRequestCardProps) {
  const { colors, sizes, aurora } = useAurora();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [loading, setLoading] = useState(false);

  const meta = PERM_LABELS[permission] ?? { icon: '🔐', label: permission };

  const handleGrant = useCallback(async () => {
    setLoading(true);
    try {
      await onGrant();
    } finally {
      setLoading(false);
    }
  }, [onGrant]);

  const handleDeny = useCallback(() => {
    onDeny();
  }, [onDeny]);

  const toggleSuppress = useCallback(() => {
    setDontAskAgain((prev) => {
      const next = !prev;
      onSuppressChange?.(next);
      return next;
    });
  }, [onSuppressChange]);

  return (
    <Card style={[styles.card, { borderColor: colors.glassBorder }]}>
      <View style={styles.header}>
        <View style={[styles.iconCircle, { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.18)' }]}>
          <Text style={{ fontSize: sizes.title }}>{meta.icon}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text, fontSize: sizes.text }]}>
            Permission required: {meta.label}
          </Text>
          <Text style={[styles.rationale, { color: colors.textMuted, fontSize: sizes.sub }]}>
            {rationale}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={handleGrant}
          disabled={loading}
          style={({ pressed }) => [
            styles.grantBtn,
            { backgroundColor: aurora.acc1, opacity: pressed || loading ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Grant ${meta.label} permission`}
        >
          {loading ? (
            <ActivityIndicator color={aurora.onAccent} size="small" />
          ) : (
            <Text style={[styles.grantText, { color: aurora.onAccent, fontSize: sizes.text }]}>Grant</Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleDeny}
          style={({ pressed }) => [
            styles.denyBtn,
            { borderColor: colors.glassBorder, opacity: pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Deny ${meta.label} permission`}
        >
          <Text style={[styles.denyText, { color: colors.text, fontSize: sizes.text }]}>Deny</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={toggleSuppress}
        style={({ pressed }) => [styles.checkboxRow, pressed && { opacity: 0.7 }]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: dontAskAgain }}
        accessibilityLabel="Don't ask again this session"
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: dontAskAgain ? aurora.acc1 : colors.glassBorder,
              backgroundColor: dontAskAgain ? aurora.acc1 : 'transparent',
            },
          ]}
        >
          {dontAskAgain ? (
            <Text style={[styles.checkmark, { color: aurora.onAccent }]}>✓</Text>
          ) : null}
        </View>
        <Text style={[styles.checkboxLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Don&apos;t ask again
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    gap: 12,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontWeight: '700',
  },
  rationale: {
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  grantBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grantText: {
    fontWeight: '700',
  },
  denyBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  denyText: {
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  checkboxLabel: {
    fontWeight: '500',
  },
});
