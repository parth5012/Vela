import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type OSPermission =
  | 'notifications'
  | 'camera'
  | 'microphone'
  | 'storage'
  | 'accessibility'
  | 'background';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

// ---------------------------------------------------------------------------
// Helpers — map expo status string to PermissionStatus
// ---------------------------------------------------------------------------
function mapExpoStatus(status: string): PermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

// ---------------------------------------------------------------------------
// checkPermission — central OS checker
// ---------------------------------------------------------------------------
export async function checkPermission(perm: OSPermission): Promise<PermissionStatus> {
  try {
    switch (perm) {
      case 'notifications': {
        const { status } = await Notifications.getPermissionsAsync();
        return mapExpoStatus(status);
      }
      case 'camera': {
        try {
          // Optional dependency — may not be installed
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const CameraMod = require('expo-camera');
          const Camera = CameraMod?.Camera ?? CameraMod?.default ?? CameraMod;
          if (Camera?.getCameraPermissionsAsync) {
            const { status } = await Camera.getCameraPermissionsAsync();
            return mapExpoStatus(status);
          }
          if (CameraMod?.getCameraPermissionsAsync) {
            const { status } = await CameraMod.getCameraPermissionsAsync();
            return mapExpoStatus(status);
          }
        } catch {
          // expo-camera not installed — undetermined
        }
        return 'undetermined';
      }
      case 'microphone': {
        try {
          // Try expo-av or expo-camera for microphone if available
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const AvMod = require('expo-av');
          if (AvMod?.Audio?.getPermissionsAsync) {
            const { status } = await AvMod.Audio.getPermissionsAsync();
            return mapExpoStatus(status);
          }
        } catch {
          // not installed
        }
        return 'undetermined';
      }
      case 'storage': {
        // Modern Android scoped storage — no runtime permission needed for app-private
        // Treat as granted; file picker handles its own permission
        return 'granted';
      }
      case 'accessibility': {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const DeviceAgent = require('../modules/device-agent').default;
          if (DeviceAgent && typeof DeviceAgent.isAccessibilityEnabled === 'function') {
            const enabled: boolean = await DeviceAgent.isAccessibilityEnabled();
            return enabled ? 'granted' : 'denied';
          }
        } catch {
          // native module not available
        }
        // Fallback: cannot determine without native module — prompt via deep-link
        return 'undetermined';
      }
      case 'background': {
        // Background execution / exact alarms — no direct check on this OS version
        return 'undetermined';
      }
      default:
        return 'undetermined';
    }
  } catch {
    return 'undetermined';
  }
}

// ---------------------------------------------------------------------------
// requestPermission — trigger OS dialog where applicable
// ---------------------------------------------------------------------------
export async function requestPermission(perm: OSPermission): Promise<PermissionStatus> {
  try {
    switch (perm) {
      case 'notifications': {
        const { status } = await Notifications.requestPermissionsAsync();
        return mapExpoStatus(status);
      }
      case 'camera': {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const CameraMod = require('expo-camera');
          const Camera = CameraMod?.Camera ?? CameraMod?.default ?? CameraMod;
          if (Camera?.requestCameraPermissionsAsync) {
            const { status } = await Camera.requestCameraPermissionsAsync();
            return mapExpoStatus(status);
          }
          if (CameraMod?.requestCameraPermissionsAsync) {
            const { status } = await CameraMod.requestCameraPermissionsAsync();
            return mapExpoStatus(status);
          }
        } catch {
          // not installed
        }
        return 'undetermined';
      }
      case 'microphone': {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const AvMod = require('expo-av');
          if (AvMod?.Audio?.requestPermissionsAsync) {
            const { status } = await AvMod.Audio.requestPermissionsAsync();
            return mapExpoStatus(status);
          }
        } catch {
          // not installed
        }
        return 'undetermined';
      }
      case 'accessibility':
      case 'storage':
      case 'background': {
        // No direct request API — guide user to Settings
        await openSettings(perm);
        return 'undetermined';
      }
      default:
        return 'undetermined';
    }
  } catch {
    return 'undetermined';
  }
}

// ---------------------------------------------------------------------------
// getRationale — privacy assurances per permission
// ---------------------------------------------------------------------------
export function getRationale(perm: OSPermission): string {
  switch (perm) {
    case 'notifications':
      return 'Vela uses notifications only to alert you when background tasks complete. No marketing or tracking.';
    case 'camera':
      return 'Camera access is only used when you explicitly start a vision task. Nothing is captured without your action.';
    case 'microphone':
      return 'Microphone access is only used for voice input you initiate. Audio never leaves your device without consent.';
    case 'storage':
      return 'Storage access lets Vela import files you pick. Vela never scans your files automatically.';
    case 'accessibility':
      return 'Accessibility lets Vela read screen content to automate tasks you approve. You can revoke this anytime in Settings.';
    case 'background':
      return 'Background permission allows Vela to finish tasks after you leave the app. No continuous tracking.';
    default:
      return 'Vela requests this permission only to complete tasks you explicitly approve.';
  }
}

// ---------------------------------------------------------------------------
// Metadata for UI
// ---------------------------------------------------------------------------
export interface PermissionMeta {
  perm: OSPermission;
  label: string;
  icon: string;
  description: string;
}

export const APP_PERMISSIONS: PermissionMeta[] = [
  {
    perm: 'notifications',
    label: 'Notifications',
    icon: '🔔',
    description: 'Task completion alerts',
  },
  {
    perm: 'camera',
    label: 'Camera',
    icon: '📷',
    description: 'Vision tasks and screenshots',
  },
  {
    perm: 'microphone',
    label: 'Microphone',
    icon: '🎙️',
    description: 'Voice input',
  },
  {
    perm: 'storage',
    label: 'Storage',
    icon: '💾',
    description: 'File imports',
  },
  {
    perm: 'accessibility',
    label: 'Accessibility',
    icon: '♿',
    description: 'Device automation',
  },
  {
    perm: 'background',
    label: 'Background',
    icon: '🔄',
    description: 'Complete tasks in background',
  },
];

// ---------------------------------------------------------------------------
// buildSettingsDeepLink — returns identifier for the settings screen
// ---------------------------------------------------------------------------
export function buildSettingsDeepLink(perm: OSPermission): string {
  if (perm === 'accessibility') {
    return 'android.settings.ACCESSIBILITY_SETTINGS';
  }
  // Generic app settings fallback
  return 'app-settings';
}

// ---------------------------------------------------------------------------
// openSettings — actually launches Settings UI
// ---------------------------------------------------------------------------
export async function openSettings(perm: OSPermission): Promise<void> {
  if (perm === 'accessibility' && Platform.OS === 'android') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IntentLauncher = require('expo-intent-launcher');
      const launcher = IntentLauncher.default ?? IntentLauncher;
      if (launcher?.startActivityAsync) {
        await launcher.startActivityAsync('android.settings.ACCESSIBILITY_SETTINGS');
        return;
      }
    } catch {
      // expo-intent-launcher not installed — fall through
    }
  }
  // Fallback: open generic app settings
  try {
    await Linking.openSettings();
  } catch {
    // Some platforms may not support openSettings
    try {
      await Linking.openURL('app-settings:');
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// shouldPrompt — session guard: do not re-prompt same permission if denied this session
// ---------------------------------------------------------------------------
export function shouldPrompt(perm: OSPermission, sessionDenied: Set<OSPermission>): boolean {
  return !sessionDenied.has(perm);
}

// ---------------------------------------------------------------------------
// Convenience — check all permissions sequentially
// ---------------------------------------------------------------------------
export async function checkAllPermissions(): Promise<Record<OSPermission, PermissionStatus>> {
  const perms: OSPermission[] = [
    'notifications',
    'camera',
    'microphone',
    'storage',
    'accessibility',
    'background',
  ];
  const result = {} as Record<OSPermission, PermissionStatus>;
  for (const p of perms) {
    result[p] = await checkPermission(p);
  }
  return result;
}
