import React, { useRef, useState, useEffect } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
  Text,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAurora } from '../../hooks/useAurora';
import { useConfigStore } from '../../store/useConfigStore';

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
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

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

  // Sync with store if saved dock side changes externally
  useEffect(() => {
    const targetX = savedDockSide === 'left' ? 16 : screenWidth - BUBBLE_SIZE - 16;
    pan.setValue({ x: targetX, y: initialY });
  }, [savedDockSide, screenWidth]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > TAP_SLOP || Math.abs(gesture.dy) > TAP_SLOP,

      onPanResponderGrant: () => {
        setIsPressing(true);
        pan.setOffset({
          x: (pan.x as unknown as { _value: number })._value,
          y: (pan.y as unknown as { _value: number })._value,
        });
        pan.setValue({ x: 0, y: 0 });
        onDragStateChange(true, false);
      },

      onPanResponderMove: (_, gesture) => {
        pan.setValue({ x: gesture.dx, y: gesture.dy });

        const currentX = (pan.x as unknown as { _offset: number })._offset + gesture.dx;
        const currentY = (pan.y as unknown as { _offset: number })._offset + gesture.dy;

        const isNearBottom = currentY > screenHeight - insets.bottom - 110;
        const isNearCenter = Math.abs(currentX + BUBBLE_SIZE / 2 - screenWidth / 2) < 90;
        const isHoveringDismiss = isNearBottom && isNearCenter;

        onDragStateChange(true, isHoveringDismiss);
      },

      onPanResponderRelease: (_, gesture) => {
        setIsPressing(false);
        pan.flattenOffset();

        const totalDist = Math.hypot(gesture.dx, gesture.dy);
        const finalX = (pan.x as unknown as { _value: number })._value;
        const finalY = (pan.y as unknown as { _value: number })._value;

        // Check if dropped into bottom dismiss zone
        const isNearBottom = finalY > screenHeight - insets.bottom - 110;
        const isNearCenter = Math.abs(finalX + BUBBLE_SIZE / 2 - screenWidth / 2) < 90;
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
        const midPoint = (screenWidth - BUBBLE_SIZE) / 2;
        const toLeft = finalX < midPoint;
        const targetX = toLeft ? 16 : screenWidth - BUBBLE_SIZE - 16;
        const clampedY = Math.min(
          Math.max(finalY, insets.top + 16),
          screenHeight - insets.bottom - BUBBLE_SIZE - 40
        );

        Animated.spring(pan, {
          toValue: { x: targetX, y: clampedY },
          bounciness: 6,
          speed: 12,
          useNativeDriver: false,
        }).start(() => {
          setPosition(toLeft ? 'left' : 'right', clampedY);
        });
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
            { scale: isPressing ? 0.95 : 1 },
          ],
          backgroundColor: colors.card,
          borderColor: aurora.acc1,
        },
      ]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel="Open Quick Chat floating overlay"
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
