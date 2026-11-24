import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  PanResponder,
  DeviceEventEmitter,
  Platform,
} from 'react-native';
import { useDeviceSessionStore } from '../../store/useDeviceSessionStore';
import { useAurora } from '../../hooks/useAurora';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { DEFAULT_ELEVATION } from '../../utils/elevation';

export function FloatingKillSwitch() {
  const isRunning = useDeviceSessionStore((s) => s.isAutomationRunning);
  const activeTool = useDeviceSessionStore((s) => s.activeToolName);
  const killSwitchTriggered = useDeviceSessionStore((s) => s.killSwitchTriggered);
  const triggerKillSwitch = useDeviceSessionStore((s) => s.triggerKillSwitch);
  const resetKillSwitch = useDeviceSessionStore((s) => s.resetKillSwitch);
  const { colors, sizes } = useAurora();
  const reducedMotion = useReducedMotion();

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Position animated value for dragging
  const pan = useRef(new Animated.ValueXY({ x: 16, y: 120 })).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  ).current;

  // Listen to hardware volume key events
  useEffect(() => {
    const volumeSub = DeviceEventEmitter.addListener('onDeviceVolumeKeyEvent', () => {
      if (useDeviceSessionStore.getState().isAutomationRunning) {
        triggerKillSwitch('volume_key');
      }
    });

    const keySub = DeviceEventEmitter.addListener('onHardwareEmergencyStop', () => {
      triggerKillSwitch('volume_key');
    });

    return () => {
      volumeSub.remove();
      keySub.remove();
    };
  }, [triggerKillSwitch]);

  // Handle visual feedback when kill switch is triggered
  useEffect(() => {
    if (killSwitchTriggered) {
      setToastMessage('⏹ Agent stopped by user');
      const timer = setTimeout(() => {
        setToastMessage(null);
        resetKillSwitch();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [killSwitchTriggered, resetKillSwitch]);

  const handleStopPress = () => {
    triggerKillSwitch('floating_button');
  };

  // Render status toast banner if triggered
  if (toastMessage) {
    return (
      <View style={styles.toastContainer} pointerEvents="none">
        <View style={styles.toastBox}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      </View>
    );
  }

  // Active-only: Render the floating button ONLY while automation is running
  if (!isRunning) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.floatingContainer,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        onPress={handleStopPress}
        style={({ pressed }) => [
          styles.stopButton,
          pressed && {
            opacity: 0.8,
            ...(!reducedMotion && { transform: [{ scale: 0.95 }] }),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Emergency Stop Device Agent"
      >
        <Text style={styles.stopIcon}>⏹</Text>
        <Text style={styles.stopText}>STOP</Text>
      </Pressable>
      {activeTool ? (
        <View style={styles.activeToolBadge}>
          <Text style={styles.activeToolText} numberOfLines={1}>
            {activeTool}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 9999,
    alignItems: 'center',
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc2626', // High-contrast emergency red
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 8,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    gap: 6,
  },
  stopIcon: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stopText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  activeToolBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    maxWidth: 120,
  },
  activeToolText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '500',
  },
  toastContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10000,
  },
  toastBox: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ffffff',
    elevation: 6,
  },
  toastText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
