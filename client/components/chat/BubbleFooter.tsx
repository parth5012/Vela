import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { formatTimestamp } from '../../utils/date';
import type { AuroraGradient, ThemeColors } from '../../utils/theme';

/**
 * Pinned timestamp footer rendered as the last child inside `styles.bubble`.
 *
 * Governed by ADR-0005 and docs/wayfinder/280-bubble-footer-spec.md.
 * NOTE: the `aurora` prop is the `AuroraGradient` object returned by
 * `useAurora()`/`getAurora()` (acc1/acc2/glow/onAccent), not `AuroraTokens`.
 */
export interface BubbleFooterProps {
  createdAt?: string;
  isUser: boolean;
  isStreaming?: boolean;
  aurora: AuroraGradient;
  colors: ThemeColors;
}

export default function BubbleFooter({
  createdAt,
  isUser,
  isStreaming = false,
  aurora,
  colors,
}: BubbleFooterProps) {
  const formatted = formatTimestamp(createdAt);
  const showDot = Boolean(isStreaming && !isUser && formatted !== null);
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!showDot) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [showDot, pulse]);

  // Defensive contract: never render "Invalid Date".
  if (formatted === null) return null;

  return (
    <View style={styles.footerRow}>
      {showDot && (
        <Animated.View
          testID="bubble-footer-streaming-dot"
          style={[styles.dot, { backgroundColor: aurora.acc1, opacity: pulse }]}
        />
      )}
      <Text
        accessibilityLabel={`Sent at ${formatted}`}
        style={[
          styles.timestamp,
          { color: isUser ? aurora.onAccent : colors.textMuted, opacity: isUser ? 0.65 : 1 },
        ]}
      >
        {formatted}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  timestamp: {
    fontSize: 10,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.25,
  },
});
