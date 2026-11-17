import React, { useCallback, useRef, useState, type ComponentProps } from 'react';
import { Animated, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { DURATIONS, EASING, SPRINGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { triggerHaptic } from '../../utils/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<ComponentProps<typeof Pressable>, 'style'> {
  /** Style for the pressable. May be a function receiving `{ pressed }`. */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Scale factor while pressed. Default 0.96 per the motion ladder. */
  scaleTo?: number;
  /** Whether to fire tactile haptic on press. Defaults to true. */
  haptic?: boolean;
  children?: React.ReactNode;
}

/**
 * Pressable with scroll-craft tactile feedback (WF-447-04 / WF-576):
 * Asymmetric press physics: rapid ease-out on press-in + snappy spring release
 * on press-out. Only transform/opacity on native driver. Dissolved to opacity-only
 * feedback under reduced motion.
 */
export default function PressableScale({
  style,
  scaleTo = 0.96,
  haptic = true,
  onPressIn,
  onPressOut,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityRole = 'button',
  children,
  ...rest
}: PressableScaleProps) {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(
    (e: any) => {
      setPressed(true);
      if (haptic && !disabled) {
        triggerHaptic('light');
      }
      onPressIn?.(e);
      if (!disabled && !reducedMotion) {
        Animated.timing(scale, {
          toValue: scaleTo,
          duration: 110,
          easing: EASING.out,
          useNativeDriver: true,
        }).start();
      }
    },
    [disabled, reducedMotion, haptic, onPressIn, scale, scaleTo]
  );

  const handlePressOut = useCallback(
    (e: any) => {
      setPressed(false);
      onPressOut?.(e);
      if (!reducedMotion) {
        Animated.spring(scale, {
          toValue: 1,
          ...SPRINGS.snappy,
        }).start();
      }
    },
    [reducedMotion, onPressOut, scale]
  );

  const baseStyle = typeof style === 'function' ? style({ pressed }) : style;

  return (
    <AnimatedPressable
      {...rest}
      style={[
        baseStyle,
        // Only transform/opacity — native driver safe. Trailing opacity is set
        // only when disabled so call-site pressed opacity survives RN style
        // flattening (reduced-motion users then keep opacity press feedback).
        { transform: [{ scale }], ...(disabled ? { opacity: 0.4 } : {}) },
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: disabled || accessibilityState?.disabled || false }}
    >
      {children}
    </AnimatedPressable>
  );
}
