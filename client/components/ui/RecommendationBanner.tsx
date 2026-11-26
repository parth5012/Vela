import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Card, Label, PrimaryButton, useAurora } from './settingsKit';
import PressableScale from './PressableScale';
import { classifyDeviceTier, getDeviceTierBadgeColors } from '../../utils/ramDetection';
import { isDarkTheme } from '../../utils/theme';

export interface RecommendationBannerProps {
  ramBytes: number | null;
  isApplied?: boolean;
  onAccept: () => void;
  onCustomize?: () => void;
  surface?: 'auto' | 'light';
  style?: StyleProp<ViewStyle>;
}

export function RecommendationBanner({
  ramBytes,
  isApplied = false,
  onAccept,
  onCustomize,
  surface = 'auto',
  style,
}: RecommendationBannerProps) {
  const { colors, sizes, theme } = useAurora();

  if (ramBytes === null || !Number.isFinite(ramBytes) || ramBytes <= 0) {
    return null;
  }

  const isLightSurface = surface === 'light' || !isDarkTheme(theme);
  const tierInfo = classifyDeviceTier(ramBytes);
  const appliedBadgeColors = getDeviceTierBadgeColors('flagship', !isLightSurface);
  const textPrimary = surface === 'light' ? '#1D1B20' : colors.text;
  const textMuted = surface === 'light' ? '#4B4654' : colors.textMuted;
  const outlineBorder = surface === 'light' ? '#E8E0F2' : colors.glassBorder;
  const cardSurfaceStyle =
    surface === 'light'
      ? { backgroundColor: '#FBF7FE', borderColor: '#E8E0F2' }
      : undefined;

  if (isApplied) {
    return (
      <Card style={[cardSurfaceStyle, style]}>
        <View style={styles.headerRow}>
          {surface === 'light' ? (
            <Text style={[styles.lightLabel, { color: textMuted, fontSize: sizes.sub }]}>
              RAM AUTO-CONFIGURATION
            </Text>
          ) : (
            <Label>RAM Auto-Configuration</Label>
          )}
          <View
            style={[
              styles.appliedBadge,
              {
                backgroundColor: appliedBadgeColors.bg,
                borderColor: appliedBadgeColors.border,
              },
            ]}
            accessibilityRole="text"
            accessibilityLabel="Recommended configuration applied"
          >
            <Text style={[styles.appliedText, { color: appliedBadgeColors.text, fontSize: sizes.sub - 1 }]}>
              Applied
            </Text>
          </View>
        </View>
        <Text style={[styles.bodyText, { color: textPrimary, fontSize: sizes.text }]}>
          Optimized for {tierInfo.name} Tier
        </Text>
        <Text style={[styles.subText, { color: textMuted, fontSize: sizes.sub }]}>
          • Model: {tierInfo.recommendedModel}
          {'\n'}• Context window: {tierInfo.contextSize} tokens
          {'\n'}• Max outputs: {tierInfo.maxTokens} tokens
        </Text>
        {onCustomize ? (
          <View style={styles.appliedActionRow}>
            <PressableScale
              scaleTo={0.96}
              onPress={onCustomize}
              style={[styles.outlineBtn, { borderColor: outlineBorder }]}
              accessibilityLabel="Customize configuration"
            >
              <Text style={[styles.outlineBtnText, { color: textPrimary, fontSize: sizes.sub }]}>
                Customize Settings
              </Text>
            </PressableScale>
          </View>
        ) : null}
      </Card>
    );
  }

  return (
    <Card style={[cardSurfaceStyle, style]}>
      {surface === 'light' ? (
        <Text style={[styles.lightLabel, { color: textMuted, fontSize: sizes.sub, marginBottom: 6 }]}>
          RECOMMENDED CONFIGURATION
        </Text>
      ) : (
        <Label>Recommended Configuration</Label>
      )}
      <Text style={[styles.bodyText, { color: textPrimary, fontSize: sizes.text }]}>
        Optimized for your {tierInfo.name} device ({tierInfo.label})
      </Text>
      <Text style={[styles.subText, { color: textMuted, fontSize: sizes.sub }]}>
        • Model: {tierInfo.recommendedModel}
        {'\n'}• Context window: {tierInfo.contextSize} tokens
        {'\n'}• Max outputs: {tierInfo.maxTokens} tokens
      </Text>
      <View style={styles.actionsRow}>
        <View style={styles.primaryBtnWrap}>
          <PrimaryButton
            label="Accept Recommended"
            onPress={onAccept}
          />
        </View>
        {onCustomize ? (
          <PressableScale
            scaleTo={0.96}
            onPress={onCustomize}
            style={[styles.outlineBtn, { borderColor: outlineBorder }]}
            accessibilityLabel="Customize configuration"
          >
            <Text style={[styles.outlineBtnText, { color: textPrimary, fontSize: sizes.sub }]}>
              Customize
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
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
  appliedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  appliedText: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bodyText: {
    fontWeight: '600',
    marginBottom: 6,
  },
  subText: {
    lineHeight: 20,
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryBtnWrap: {
    flex: 1,
  },
  appliedActionRow: {
    marginTop: 10,
    flexDirection: 'row',
  },
  outlineBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outlineBtnText: {
    fontWeight: '600',
  },
});
