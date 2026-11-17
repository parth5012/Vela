import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PressableScale from '../ui/PressableScale';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { AuroraGradient } from '../../utils/theme';

export interface SendStopButtonProps {
  isStreaming: boolean;
  canSend: boolean;
  onPress: () => void;
  aurora: AuroraGradient;
  disabledColor?: string;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * SendStopButton: tactile send/stop micro-interaction.
 *
 * Micro-interactions:
 * 1. Native-driver crossfade & scale morph between "Send" (aurora gradient)
 *    and "Stop" (pulsing red square/text).
 * 2. Subtle rhythmic pulse when streaming, cleanly teardown on completion.
 * 3. Reduced motion dissolves transforms into instant state transition or
 *    subtle opacity crossfade with continuous pulse suppressed.
 * 4. Only transform & opacity animated — 100% on native driver.
 */
export default function SendStopButton({
  isStreaming,
  canSend,
  onPress,
  aurora,
  disabledColor = '#334155',
  fontSize = 15,
  style,
}: SendStopButtonProps) {
  const reducedMotion = useReducedMotion();
  const morphAnim = useRef(new Animated.Value(isStreaming ? 1 : 0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Morph transition between Send (0) and Stop (1)
  useEffect(() => {
    if (reducedMotion) {
      morphAnim.setValue(isStreaming ? 1 : 0);
      return;
    }

    const anim = Animated.timing(morphAnim, {
      toValue: isStreaming ? 1 : 0,
      duration: DURATIONS.reveal, // 200ms
      easing: EASING.out,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [isStreaming, reducedMotion, morphAnim]);

  // Streaming rhythmic pulse loop (suppressed under reduced motion)
  useEffect(() => {
    if (!isStreaming || reducedMotion) {
      pulseAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 650,
          easing: EASING.out,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 650,
          easing: EASING.out,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isStreaming, reducedMotion, pulseAnim]);

  const sendOpacity = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const sendScale = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.75],
  });

  const stopOpacity = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const stopScale = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.75, 1],
  });

  const isDisabled = !isStreaming && !canSend;
  const activeShadowColor = isStreaming ? '#ef4444' : aurora.acc1;
  const showShadow = isStreaming || canSend;

  return (
    <PressableScale
      scaleTo={0.93}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={isStreaming ? 'Stop generating' : 'Send message'}
      accessibilityState={{ busy: isStreaming, disabled: isDisabled }}
      style={[
        styles.container,
        {
          shadowColor: activeShadowColor,
          shadowOpacity: showShadow ? 0.4 : 0,
          elevation: showShadow ? 8 : 0,
        },
        style,
      ]}
    >
      {/* Send Layer */}
      <Animated.View
        testID="send-button-layer-send"
        style={[
          StyleSheet.absoluteFill,
          styles.layer,
          {
            opacity: sendOpacity,
            transform: reducedMotion ? [] : [{ scale: sendScale }],
          },
        ]}
        pointerEvents={isStreaming ? 'none' : 'auto'}
      >
        {canSend ? (
          <LinearGradient
            colors={[aurora.acc1, aurora.acc2]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          >
            <Text style={[styles.buttonText, { fontSize, color: aurora.onAccent }]}>
              Send
            </Text>
          </LinearGradient>
        ) : (
          <View style={[styles.disabledBackground, { backgroundColor: disabledColor }]}>
            <Text style={[styles.buttonText, { fontSize, color: '#94a3b8' }]}>
              Send
            </Text>
          </View>
        )}
      </Animated.View>

      {/* Stop Layer */}
      <Animated.View
        testID="send-button-layer-stop"
        style={[
          StyleSheet.absoluteFill,
          styles.layer,
          styles.stopBackground,
          {
            opacity: stopOpacity,
            transform: reducedMotion
              ? []
              : [{ scale: stopScale }, { scale: pulseAnim }],
          },
        ]}
        pointerEvents={isStreaming ? 'auto' : 'none'}
      >
        <Text style={[styles.buttonText, { fontSize, color: '#ffffff' }]}>
          Stop
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  layer: {
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradient: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBackground: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopBackground: {
    backgroundColor: '#ef4444',
  },
  buttonText: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
