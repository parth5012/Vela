import { Platform, Vibration } from 'react-native';

export type HapticType = 'light' | 'selection' | 'medium' | 'success' | 'warning';

/**
 * Native cross-platform haptic feedback utility.
 * Uses discrete vibration patterns to provide physical confirmation
 * on touch interactions without requiring extra native binaries.
 */
export function triggerHaptic(type: HapticType = 'light'): void {
  if (Platform.OS === 'web') return;
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
