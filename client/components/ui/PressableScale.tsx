import React, { useCallback, useRef, useState, type ComponentProps } from 'react';
import { Animated, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<ComponentProps<typeof Pressable>, 'style'> {
  /** Style for the pressable. May be a function receiving `{ pressed }`. */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Scale factor while pressed. Default 0.97 per the scroll-craft floor. */
  scaleTo?: number;
  children?: React.ReactNode;
}

/**
 * Pressable with scroll-craft press feedback (WF-447-04):
 * scale 0.97 on press-in, back to 1 on press-out, only transform/opacity on
 * the native driver, ease-out curves, dissolved to opacity-only feedback under
 * reduced motion. Honours `disabled` (opacity 0.4) and forwards
 * accessibilityState (always reporting disabled) / accessibilityLabel.
 */
export default function PressableScale({
  style,
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  children,
  ...rest
}: PressableScaleProps) {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(
    (e: any) => {
      setPressed(true);
      onPressIn?.(e);
      if (!disabled && !reducedMotion) {
        Animated.timing(scale, {
          toValue: scaleTo,
          duration: DURATIONS.press,
          easing: EASING.out,
          useNativeDriver: true,
        }).start();
      }
    },
    [disabled, reducedMotion, onPressIn, scale, scaleTo]
  );

  const handlePressOut = useCallback(
    (e: any) => {
      setPressed(false);
      onPressOut?.(e);
      if (!reducedMotion) {
        Animated.timing(scale, {
          toValue: 1,
          duration: DURATIONS.press,
          easing: EASING.out,
          useNativeDriver: true,
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
        // Only transform/opacity — native driver safe.
        { transform: [{ scale }], opacity: disabled ? 0.4 : 1 },
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled: disabled || accessibilityState?.disabled || false }}
    >
      {children}
    </AnimatedPressable>
  );
}
