import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Card, Label, useAurora } from './settingsKit';
import {
  classifyDeviceTier,
  getDeviceTierBadgeColors,
  getGpuBackendPreference,
  type GpuVendor,
} from '../../utils/ramDetection';
import { isDarkTheme, THEME_COLORS } from '../../utils/theme';

export interface DeviceCapabilityCardProps {
  ramBytes: number | null;
  gpuVendor?: GpuVendor | null;
  gpuBackendPreference?: 'auto' | 'opencl' | 'vulkan' | 'cpu';
  modelName?: string;
  freeStorageBytes?: number | null;
  architecture?: string | null;
  compact?: boolean;
  surface?: 'auto' | 'light';
  style?: StyleProp<ViewStyle>;
}

export function DeviceCapabilityCard({
  ramBytes,
  gpuVendor = 'unknown',
  gpuBackendPreference = 'auto',
  modelName,
  freeStorageBytes,
  architecture,
  compact = false,
  surface = 'auto',
  style,
}: DeviceCapabilityCardProps) {
  const { colors, sizes, theme } = useAurora();
  const isLightSurface = surface === 'light' || !isDarkTheme(theme);
  const tierInfo = classifyDeviceTier(ramBytes);

  const isDetecting = ramBytes === null || ramBytes === undefined;
  const ramInvalid = !isDetecting && (!Number.isFinite(ramBytes) || ramBytes <= 0);
  const effectiveTierInfo = ramInvalid ? classifyDeviceTier(0) : tierInfo;
  const badgeColor = getDeviceTierBadgeColors(effectiveTierInfo.tier, !isLightSurface);
  const badgeLabel = isDetecting ? 'Detecting…' : effectiveTierInfo.label;

  const lightPalette = THEME_COLORS.berry;
  const textPrimary = surface === 'light' ? lightPalette.text : colors.text;
  const textMuted = surface === 'light' ? lightPalette.textMuted : colors.textMuted;
  const cardSurfaceStyle =
    surface === 'light'
      ? { backgroundColor: lightPalette.background, borderColor: lightPalette.glassBorder }
      : undefined;

  const resolvedVendor = gpuVendor ?? null;
  const gpuLabel =
    resolvedVendor === null
      ? 'GPU: Detecting…'
      : `GPU: ${resolvedVendor.toUpperCase()} (${getGpuBackendPreference(
          resolvedVendor,
          gpuBackendPreference,
          modelName
        ).toUpperCase()} compute)`;

  const hardwareDetailsText = `${gpuLabel}${
    typeof freeStorageBytes === 'number' && Number.isFinite(freeStorageBytes) && freeStorageBytes > 0
      ? ` • ${(freeStorageBytes / (1024 ** 3)).toFixed(1)} GB free`
      : ''
  }${!compact && architecture ? ` • ${architecture}` : ''}`;

  return (
    <Card style={[cardSurfaceStyle, style]}>
      <View style={cardStyles.headerRow}>
        {surface === 'light' ? (
          <Text style={[cardStyles.lightLabel, { color: textMuted, fontSize: sizes.sub }]}>
            HARDWARE CAPABILITIES
          </Text>
        ) : (
          <Label>Hardware Capabilities</Label>
        )}
        <View
          style={[
            cardStyles.badge,
            {
              backgroundColor: badgeColor.bg,
              borderColor: badgeColor.border,
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`Device Tier: ${badgeLabel}`}
        >
          <Text
            style={[
              cardStyles.badgeText,
              { color: badgeColor.text, fontSize: sizes.sub - 1 },
            ]}
          >
            {badgeLabel}
          </Text>
        </View>
      </View>

      {isDetecting ? (
        <Text style={[cardStyles.mutedText, { color: textMuted, fontSize: sizes.sub }]}>
          Detecting hardware memory profile...
        </Text>
      ) : ramInvalid ? (
        <View style={cardStyles.infoBlock}>
          <Text style={[cardStyles.primaryText, { color: textPrimary, fontSize: sizes.text }]}>
            RAM: Unknown
          </Text>
          <Text style={[cardStyles.detailsText, { color: textMuted, fontSize: sizes.sub }]}>
            {hardwareDetailsText}
          </Text>
          <Text style={[cardStyles.mutedText, { color: textMuted, fontSize: sizes.sub }]}>
            We couldn't read your device's total memory. Manual selection is available with OOM safeguards.
          </Text>
        </View>
      ) : (
        <View style={cardStyles.infoBlock}>
          <Text style={[cardStyles.primaryText, { color: textPrimary, fontSize: sizes.text }]}>
            {`${(ramBytes / (1024 ** 3)).toFixed(1)} GB physical memory`}
          </Text>
          <Text style={[cardStyles.detailsText, { color: textMuted, fontSize: sizes.sub }]}>
            {hardwareDetailsText}
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
  lightLabel: {
    fontWeight: '700',
    letterSpacing: 0.6,
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
