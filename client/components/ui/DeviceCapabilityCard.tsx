import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Card, Label, useAurora } from './settingsKit';
import {
  classifyDeviceTier,
  GPU_BACKEND_TABLE,
  type GpuVendor,
} from '../../utils/ramDetection';

export interface DeviceCapabilityCardProps {
  ramBytes: number | null;
  gpuVendor?: GpuVendor | null;
  freeStorageBytes?: number | null;
  architecture?: string | null;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function DeviceCapabilityCard({
  ramBytes,
  gpuVendor = 'unknown',
  freeStorageBytes,
  architecture,
  compact = false,
  style,
}: DeviceCapabilityCardProps) {
  const { colors, sizes } = useAurora();
  const tierInfo = classifyDeviceTier(ramBytes);
  const ramInvalid = ramBytes !== null && ramBytes <= 0;

  const resolvedVendor = gpuVendor || 'unknown';
  const backend = GPU_BACKEND_TABLE[resolvedVendor] ?? 'cpu';

  return (
    <Card style={style}>
      <View style={cardStyles.headerRow}>
        <Label>Hardware Capabilities</Label>
        <View
          style={[
            cardStyles.badge,
            {
              backgroundColor: tierInfo.badgeColor.bg,
              borderColor: tierInfo.badgeColor.border,
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`Device Tier: ${tierInfo.label}`}
        >
          <Text
            style={[
              cardStyles.badgeText,
              { color: tierInfo.badgeColor.text, fontSize: sizes.sub - 1 },
            ]}
          >
            {tierInfo.label}
          </Text>
        </View>
      </View>

      {ramBytes === null ? (
        <Text style={[cardStyles.mutedText, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Detecting hardware memory profile...
        </Text>
      ) : ramInvalid ? (
        <View style={cardStyles.infoBlock}>
          <Text style={[cardStyles.primaryText, { color: colors.text, fontSize: sizes.text }]}>
            RAM: Unknown
          </Text>
          <Text style={[cardStyles.mutedText, { color: colors.textMuted, fontSize: sizes.sub }]}>
            We couldn't read your device's total memory. Manual selection is available with OOM safeguards.
          </Text>
        </View>
      ) : (
        <View style={cardStyles.infoBlock}>
          <Text style={[cardStyles.primaryText, { color: colors.text, fontSize: sizes.text }]}>
            {`${(ramBytes / (1024 ** 3)).toFixed(1)} GB physical memory`}
          </Text>
          <Text style={[cardStyles.detailsText, { color: colors.textMuted, fontSize: sizes.sub }]}>
            {`GPU: ${resolvedVendor.toUpperCase()} (${backend.toUpperCase()} compute)`}
            {typeof freeStorageBytes === 'number' && freeStorageBytes > 0
              ? ` • ${(freeStorageBytes / (1024 ** 3)).toFixed(1)} GB free`
              : ''}
            {!compact && architecture ? ` • ${architecture}` : ''}
          </Text>
        </View>
      )}
    </Card>
  );
}

const cardStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  infoBlock: {
    gap: 4,
  },
  primaryText: {
    fontWeight: '600',
  },
  detailsText: {
    lineHeight: 18,
  },
  mutedText: {
    lineHeight: 18,
  },
});
