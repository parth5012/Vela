import React, { useRef, useState, useEffect } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAurora } from '../../hooks/useAurora';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useConfigStore } from '../../store/useConfigStore';
import { triggerHaptic } from '../../utils/haptics';

interface FloatingBubbleProps {
  onExpand: () => void;
  onDismiss: () => void;
  onDragStateChange: (isDragging: boolean, isHoveringDismiss: boolean) => void;
}

const BUBBLE_SIZE = 56;
const TAP_SLOP = 8;

export default function FloatingBubble({
  onExpand,
  onDismiss,
  onDragStateChange,
}: FloatingBubbleProps) {
  const { colors, aurora } = useAurora();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const savedDockSide = useConfigStore((s) => s.floatingOverlay.dockSide);
  const savedDockY = useConfigStore((s) => s.floatingOverlay.dockY);
  const setPosition = useConfigStore((s) => s.setFloatingOverlayPosition);

  const initialX = savedDockSide === 'left' ? 16 : screenWidth - BUBBLE_SIZE - 16;
  const initialY = Math.min(
    Math.max(savedDockY, insets.top + 16),
    screenHeight - insets.bottom - BUBBLE_SIZE - 40
  );

  const pan = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;
  const [isPressing, setIsPressing] = useState(false);

  const positionRef = useRef({ x: initialX, y: initialY });
  const isHoveringDismissRef = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const id = pan.addListener((value) => {
      positionRef.current = value;
    });
    return () => {
      pan.removeListener(id);
    };
  }, [pan]);

  // Keep references to latest dimensions and insets for gesture handlers
  const layoutRef = useRef({ screenWidth, screenHeight, insets });
  useEffect(() => {
    layoutRef.current = { screenWidth, screenHeight, insets };
  }, [screenWidth, screenHeight, insets]);

  // Sync with store and window size adjustments
  useEffect(() => {
    const targetX = savedDockSide === 'left' ? 16 : screenWidth - BUBBLE_SIZE - 16;
    const clampedY = Math.min(
      Math.max(savedDockY, insets.top + 16),
      screenHeight - insets.bottom - BUBBLE_SIZE - 40
    );
    pan.setValue({ x: targetX, y: clampedY });
  }, [savedDockSide, savedDockY, screenWidth, screenHeight, insets.top, insets.bottom]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > TAP_SLOP || Math.abs(gesture.dy) > TAP_SLOP,

      onPanResponderGrant: () => {
        setIsPressing(true);
        pan.stopAnimation((currentPos) => {
          pan.setOffset(currentPos);
          pan.setValue({ x: 0, y: 0 });
          onDragStateChange(true, false);
        });
      },

      onPanResponderMove: (_, gesture) => {
        pan.setValue({ x: gesture.dx, y: gesture.dy });

        const { screenWidth: curW, screenHeight: curH, insets: curInsets } = layoutRef.current;
        const currentX = positionRef.current.x;
        const currentY = positionRef.current.y;

        const isNearBottom = currentY > curH - curInsets.bottom - 110;
        const isNearCenter = Math.abs(currentX + BUBBLE_SIZE / 2 - curW / 2) < 90;
        const isHoveringDismiss = isNearBottom && isNearCenter;

        if (isHoveringDismiss && !isHoveringDismissRef.current) {
          triggerHaptic('medium');
        }
        isHoveringDismissRef.current = isHoveringDismiss;

        onDragStateChange(true, isHoveringDismiss);
      },

      onPanResponderTerminate: () => {
        setIsPressing(false);
        pan.flattenOffset();
        isHoveringDismissRef.current = false;
        onDragStateChange(false, false);
      },

      onPanResponderRelease: (_, gesture) => {
        setIsPressing(false);
        pan.flattenOffset();
        isHoveringDismissRef.current = false;

        const { screenWidth: curW, screenHeight: curH, insets: curInsets } = layoutRef.current;
        const totalDist = Math.hypot(gesture.dx, gesture.dy);
        const finalX = positionRef.current.x;
        const finalY = positionRef.current.y;

        // Check if dropped into bottom dismiss zone
        const isNearBottom = finalY > curH - curInsets.bottom - 110;
        const isNearCenter = Math.abs(finalX + BUBBLE_SIZE / 2 - curW / 2) < 90;
        if (isNearBottom && isNearCenter) {
          onDragStateChange(false, false);
          onDismiss();
          return;
        }

        onDragStateChange(false, false);

        // Tap detected
        if (totalDist < TAP_SLOP) {
          onExpand();
          return;
        }

        // Snap to nearest edge
        const midPoint = (curW - BUBBLE_SIZE) / 2;
        const toLeft = finalX < midPoint;
        const targetX = toLeft ? 16 : curW - BUBBLE_SIZE - 16;
        const clampedY = Math.min(
          Math.max(finalY, curInsets.top + 16),
          curH - curInsets.bottom - BUBBLE_SIZE - 40
        );

        if (reducedMotionRef.current) {
          pan.setValue({ x: targetX, y: clampedY });
          setPosition(toLeft ? 'left' : 'right', clampedY);
        } else {
          Animated.spring(pan, {
            toValue: { x: targetX, y: clampedY },
            bounciness: 6,
            speed: 12,
            useNativeDriver: Platform.OS !== 'web',
          }).start(() => {
            setPosition(toLeft ? 'left' : 'right', clampedY);
          });
        }
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          transform: [
            { translateX: pan.x },
            { translateY: pan.y },
            { scale: isPressing && !reducedMotion ? 0.95 : 1 },
          ],
          opacity: isPressing && reducedMotion ? 0.8 : 1,
          backgroundColor: colors.card,
          borderColor: aurora.acc1,
        },
      ]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel="Open Quick Chat floating overlay"
      accessibilityActions={[{ name: 'activate', label: 'Open Quick Chat' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') {
          onExpand();
        }
      }}
      {...panResponder.panHandlers}
    >
      <Text style={styles.bubbleIcon}>💬</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    shadowColor: 'rgba(20, 15, 30, 0.45)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  bubbleIcon: {
    fontSize: 22,
  },
});
