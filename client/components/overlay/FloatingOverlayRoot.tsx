import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import FloatingBubble from './FloatingBubble';
import MiniChatPanel from './MiniChatPanel';
import DismissDropZone from './DismissDropZone';

export default function FloatingOverlayRoot() {
  const isEnabled = useConfigStore((s) => s.floatingOverlay.enabled);
  const setEnabled = useConfigStore((s) => s.setFloatingOverlayEnabled);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringDismiss, setIsHoveringDismiss] = useState(false);

  if (!isEnabled) {
    return null;
  }

  const handleExpand = () => {
    setIsExpanded(true);
  };

  const handleMinimize = () => {
    setIsExpanded(false);
  };

  const handleDismiss = () => {
    setIsExpanded(false);
    setEnabled(false);
  };

  const handleDragStateChange = (dragging: boolean, hoveringDismiss: boolean) => {
    setIsDragging(dragging);
    setIsHoveringDismiss(hoveringDismiss);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {isExpanded ? (
        <>
          <Pressable
            style={styles.backdrop}
            onPress={handleMinimize}
            accessibilityRole="button"
            accessibilityLabel="Close overlay backdrop"
          />
          <MiniChatPanel onMinimize={handleMinimize} onClose={handleDismiss} />
        </>
      ) : (
        <>
          <FloatingBubble
            onExpand={handleExpand}
            onDismiss={handleDismiss}
            onDragStateChange={handleDragStateChange}
          />
          <DismissDropZone visible={isDragging} isHovered={isHoveringDismiss} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 12, 22, 0.45)',
    zIndex: 9998,
  },
});
