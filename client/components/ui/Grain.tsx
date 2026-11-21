import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAurora } from '../../hooks/useAurora';

// Scroll-craft grain overlay (WF-447-03). A tiled 64x64 noise PNG at 4%
// opacity breaks up gradient banding on flat dark grounds. Mounts absolutely,
// behind interactive content, and never intercepts touches.
const GRAIN_TILE = require('../../assets/grain.png');

/**
 * Absolute-fill grain overlay. Mount it as the first child of a screen (or a
 * positioned wrapper) so it sits behind the content layered above it.
 */
export default function Grain() {
  const { theme } = useAurora();
  const isDark = theme === 'noir' || theme === 'chrome';
  return (
    <View
      testID="grain-overlay"
      style={[StyleSheet.absoluteFill, { opacity: isDark ? 0.04 : 0.012 }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={GRAIN_TILE} style={StyleSheet.absoluteFill} resizeMode="repeat" />
    </View>
  );
}
