import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAurora } from '../../hooks/useAurora';

interface DismissDropZoneProps {
  visible: boolean;
  isHovered: boolean;
}

export default function DismissDropZone({ visible, isHovered }: DismissDropZoneProps) {
  const { colors, sizes } = useAurora();

  if (!visible) {
    return null;
  }

  const backgroundColor = isHovered ? 'rgba(239, 68, 68, 0.28)' : 'rgba(50, 50, 65, 0.45)';
  const borderColor = isHovered ? '#ef4444' : colors.border;
  const textColor = isHovered ? '#f87171' : colors.textMuted;

  return (
    <View style={styles.container} pointerEvents="none">
      <View
        style={[
          styles.target,
          {
            backgroundColor,
            borderColor,
            transform: [{ scale: isHovered ? 1.08 : 1 }],
          },
        ]}
      >
        <Text style={[styles.icon, { color: textColor }]}>✕</Text>
        <Text style={[styles.label, { color: textColor, fontSize: sizes.sub }]}>
          {isHovered ? 'Release to close' : 'Drag here to close'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
  },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  icon: {
    fontSize: 16,
    fontWeight: '700',
  },
  label: {
    fontWeight: '600',
  },
});
