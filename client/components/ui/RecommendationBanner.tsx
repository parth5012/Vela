import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Card, Label, PrimaryButton, useAurora } from './settingsKit';
import PressableScale from './PressableScale';
import { classifyDeviceTier } from '../../utils/ramDetection';

export interface RecommendationBannerProps {
  ramBytes: number | null;
  isApplied?: boolean;
  onAccept: () => void;
  onCustomize?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function RecommendationBanner({
  ramBytes,
  isApplied = false,
  onAccept,
  onCustomize,
  style,
}: RecommendationBannerProps) {
  const { colors, sizes } = useAurora();

  if (ramBytes === null || ramBytes <= 0) {
    return null;
  }

  const tierInfo = classifyDeviceTier(ramBytes);

  if (isApplied) {
    return (
      <Card style={style}>
        <View style={styles.headerRow}>
          <Label>RAM Auto-Configuration</Label>
          <View
            style={[
              styles.appliedBadge,
              { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: '#10b981' },
            ]}
            accessibilityRole="text"
            accessibilityLabel="Recommended configuration applied"
          >
            <Text style={[styles.appliedText, { fontSize: sizes.sub - 1 }]}>Applied</Text>
          </View>
        </View>
        <Text style={[styles.bodyText, { color: colors.text, fontSize: sizes.text }]}>
          Optimized for {tierInfo.name} Tier
        </Text>
        <Text style={[styles.subText, { color: colors.textMuted, fontSize: sizes.sub }]}>
          • Model: {tierInfo.recommendedModel}
          {'\n'}• Context window: {tierInfo.contextSize} tokens
          {'\n'}• Max outputs: {tierInfo.maxTokens} tokens
        </Text>
        {onCustomize ? (
          <View style={styles.appliedActionRow}>
            <PressableScale
              scaleTo={0.96}
              onPress={onCustomize}
              style={[styles.outlineBtn, { borderColor: colors.glassBorder }]}
              accessibilityLabel="Customize configuration"
            >
              <Text style={[styles.outlineBtnText, { color: colors.text, fontSize: sizes.sub }]}>
                Customize Settings
              </Text>
            </PressableScale>
          </View>
        ) : null}
      </Card>
    );
  }

  return (
    <Card style={style}>
      <Label>Recommended Configuration</Label>
      <Text style={[styles.bodyText, { color: colors.text, fontSize: sizes.text }]}>
        Optimized for your {tierInfo.name} device ({tierInfo.label})
      </Text>
      <Text style={[styles.subText, { color: colors.textMuted, fontSize: sizes.sub }]}>
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
            style={[styles.outlineBtn, { borderColor: colors.glassBorder }]}
            accessibilityLabel="Customize configuration"
          >
            <Text style={[styles.outlineBtnText, { color: colors.text, fontSize: sizes.sub }]}>
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
  appliedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  appliedText: {
    color: '#10b981',
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
  mutedText: {
    lineHeight: 18,
    marginTop: 4,
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
