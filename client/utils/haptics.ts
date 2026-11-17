import { Platform, Vibration } from 'react-native';

export type HapticType = 'light' | 'selection' | 'medium' | 'success' | 'warning';

let lastHapticTimestamp = 0;
const HAPTIC_THROTTLE_MS = 60;

/**
 * Native cross-platform haptic feedback utility.
 * Uses discrete vibration patterns to provide physical confirmation
 * on touch interactions without requiring extra native binaries.
 * Throttled to prevent double-buzz glitches on composite press targets.
 */
export function triggerHaptic(type: HapticType = 'light'): void {
  if (Platform.OS === 'web') return;
  // On iOS without expo-haptics, Vibration.vibrate() triggers a fixed ~400ms system buzz
  // regardless of millisecond argument. We avoid jarring buzzes on routine press/selection
  // events while preserving intentional multi-pulse alert patterns for success and warning.
  if (Platform.OS === 'ios' && (type === 'light' || type === 'selection' || type === 'medium')) {
    return;
  }
  const now = Date.now();
  if (now - lastHapticTimestamp < HAPTIC_THROTTLE_MS && type === 'light') {
    return;
  }
  lastHapticTimestamp = now;
  try {
    switch (type) {
      case 'light':
      case 'selection':
        Vibration.vibrate(8);
        break;
      case 'medium':
        Vibration.vibrate(18);
        break;
      case 'success':
        Vibration.vibrate([0, 10, 40, 15]);
        break;
      case 'warning':
        Vibration.vibrate([0, 20, 40, 20]);
        break;
    }
  } catch {
    // Ignore environments where vibration is unavailable
  }
}
