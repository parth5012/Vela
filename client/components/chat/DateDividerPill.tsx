import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '../../utils/theme';

/**
 * Centered glassmorphic day divider pill for the inverted chat feed.
 *
 * Governed by ADR-0005 and docs/wayfinder/281-date-divider-spec.md.
 * In-flow (non-sticky) badge — sticky headers are rejected on inverted
 * Android FlatLists due to upstream rendering bugs.
 */
export interface DateDividerPillProps {
  label: string;
  colors: ThemeColors;
}

export default function DateDividerPill({ label, colors }: DateDividerPillProps) {
  return (
    <View style={styles.container}>
      <View
        style={[
          styles.pill,
          { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        ]}
      >
        <Text style={[styles.text, { color: colors.textMuted }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 12,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
