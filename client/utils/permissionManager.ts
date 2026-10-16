import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { DeviceAgentNative } from '../modules/device-agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type OSPermission =
  | 'notifications'
  | 'camera'
  | 'microphone'
  | 'storage'
  | 'accessibility'
  | 'background'
  | 'phone'
  | 'contacts';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export type SettingsDeepLinkTarget =
  | OSPermission
  | 'overlay'
  | 'restricted_settings';

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
      case 'phone': {
        try {
          const DeviceAgent = require('../modules/device-agent').default;
          if (DeviceAgent && typeof DeviceAgent.checkSelfPermission === 'function') {
            const res = await DeviceAgent.checkSelfPermission('android.permission.CALL_PHONE');
            if (res && (res.status === 'granted' || res.status === 'denied')) {
              return res.status;
            }
          }
        } catch {
          // native module not available
        }
        return 'undetermined';
      }
      case 'contacts': {
        try {
          const DeviceAgent = require('../modules/device-agent').default;
          if (DeviceAgent && typeof DeviceAgent.checkSelfPermission === 'function') {
            const res = await DeviceAgent.checkSelfPermission('android.permission.READ_CONTACTS');
            if (res && (res.status === 'granted' || res.status === 'denied')) {
              return res.status;
            }
          }
        } catch {
          // native module not available
        }
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
      case 'background':
      case 'phone':
      case 'contacts': {
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
    case 'phone':
      return 'Phone access allows Vela to initiate phone calls directly when you approve. No calls are placed without your confirmation.';
    case 'contacts':
      return 'Contacts access allows Vela to search and read device contacts to address messages or calls you approve.';
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
  {
    perm: 'phone',
    label: 'Phone Calls',
    icon: '📞',
    description: 'Direct phone calling (CALL_PHONE)',
  },
  {
    perm: 'contacts',
    label: 'Contacts',
    icon: '👥',
    description: 'Read and search contacts (READ_CONTACTS)',
  },
];

// ---------------------------------------------------------------------------
// buildSettingsDeepLink — returns action string or URI for Settings
// ---------------------------------------------------------------------------
export function buildSettingsDeepLink(target: SettingsDeepLinkTarget): string {
  if (target === 'accessibility') {
    return 'android.settings.ACCESSIBILITY_SETTINGS';
  }
  if (target === 'overlay') {
    return 'android.settings.action.MANAGE_OVERLAY_PERMISSION';
  }
  // Restricted settings (Android 13+ / API 33+ sideload guard), Phone, Contacts,
  // and general app permissions all navigate to the application details screen.
  // We return the real Android Intent action string.
  return 'android.settings.APPLICATION_DETAILS_SETTINGS';
}

export interface OpenSettingsResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Returns which native DeviceAgentModule method is required for `target`.
 * Used by the capability guard so missing native methods do not silently
 * degrade into Linking.openSettings().
 */
function requiredNativeMethod(target: SettingsDeepLinkTarget): string | null {
  if (target === 'overlay' || target === 'accessibility') {
    return 'openSettingsAction';
  }
  return null;
}

function getDeviceAgentModule(): DeviceAgentNative | null {
  try {
    const mod = require('../modules/device-agent');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

/**
 * Capability guard: check if native openSettingsAction is available.
 */
export function canOpenSettingsAction(): boolean {
  if (Platform.OS !== 'android') return false;
  const deviceAgent = getDeviceAgentModule();
  return Boolean(deviceAgent && typeof deviceAgent.openSettingsAction === 'function');
}

// ---------------------------------------------------------------------------
// openSettings — actually launches Settings UI
// ---------------------------------------------------------------------------
export async function openSettings(
  target: SettingsDeepLinkTarget = 'notifications'
): Promise<OpenSettingsResult> {
  const method = requiredNativeMethod(target);
  if (method) {
    if (Platform.OS !== 'android') {
      return {
        success: false,
        error: `${target} settings are only supported on Android`,
      };
    }
    const deviceAgent = getDeviceAgentModule();
    if (!deviceAgent) {
      return {
        success: false,
        error: 'DeviceAgentModule did not load',
      };
    }
    if (typeof (deviceAgent as unknown as Record<string, unknown>)[method] !== 'function') {
      return {
        success: false,
        error: `the module does not provide ${method}()`,
      };
    }
    const action = buildSettingsDeepLink(target);
    const needsPackageUri = target === 'overlay';
    try {
      const res = await (deviceAgent as {
        openSettingsAction?: (act: string, needsPkg: boolean) => Promise<OpenSettingsResult>;
      }).openSettingsAction!(action, needsPackageUri);
      return res ?? { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  // App details settings path (restricted_settings, phone, contacts, notifications, general)
  try {
    await Linking.openSettings();
    return { success: true };
  } catch (err: unknown) {
    try {
      await Linking.openURL('app-settings:');
      return { success: true };
    } catch {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
    'phone',
    'contacts',
  ];
  const result = {} as Record<OSPermission, PermissionStatus>;
  for (const p of perms) {
    result[p] = await checkPermission(p);
  }
  return result;
}
