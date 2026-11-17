import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface TypingIndicatorProps {
  /** Color of the typing indicator dots. Defaults to #94a3b8. */
  dotColor?: string;
  /** Size of each dot in dp. Defaults to 6. */
  dotSize?: number;
  /** Space between dots in dp. Defaults to 4. */
  spacing?: number;
  /** Custom container style. */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for screen readers. Defaults to "AI is thinking". */
  accessibilityLabel?: string;
}

/**
 * TypingIndicator: Tactile AI thinking / generation micro-interaction.
 *
 * Micro-interactions:
 * 1. 3 dots with staggered phase offset (120ms).
 * 2. Subtle translateY wave (0 -> -3px -> 0) and opacity pulse (0.4 -> 1.0).
 * 3. 100% native driver execution (only transform & opacity).
 * 4. Reduced-motion fallback: transforms dissolved, stationary gentle opacity.
 */
export default function TypingIndicator({
  dotColor = '#94a3b8',
  dotSize = 6,
  spacing = 4,
  style,
  accessibilityLabel = 'AI is thinking',
}: TypingIndicatorProps) {
  const reducedMotion = useReducedMotion();

  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      dot1.setValue(0.5);
      dot2.setValue(0.5);
      dot3.setValue(0.5);
      return;
    }

    const createDotLoop = (anim: Animated.Value) => {
      return Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 320,
          easing: EASING.out,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 320,
          easing: EASING.out,
          useNativeDriver: true,
        }),
        Animated.delay(200),
      ]);
    };

    const loop = Animated.loop(
      Animated.stagger(120, [
        createDotLoop(dot1),
        createDotLoop(dot2),
        createDotLoop(dot3),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [reducedMotion, dot1, dot2, dot3]);

  const dots = [dot1, dot2, dot3];

  return (
    <View
      style={[styles.container, style]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      testID="typing-indicator"
    >
      {dots.map((dotAnim, index) => {
        const translateY = dotAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -3],
        });
        const opacity = dotAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.4, 1.0],
        });

        return (
          <Animated.View
            key={index}
            testID={`typing-dot-${index}`}
            style={[
              styles.dot,
              {
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: dotColor,
                marginHorizontal: spacing / 2,
                opacity: reducedMotion ? 0.75 : opacity,
                transform: reducedMotion ? [] : [{ translateY }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  dot: {
    flexShrink: 0,
  },
});
