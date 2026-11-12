// ---------------------------------------------------------------------------
// Onboarding permission set (#556)
//
// The setup wizard's permissions step asks for notifications, camera and
// microphone via independent OS dialogs, and offers accessibility through
// AccessibilityGuide. Storage/background/phone/contacts are intentionally
// excluded — inert or point-of-use only.
// ---------------------------------------------------------------------------
import type { OSPermission, OSPermissionStatus } from '../store/useConfigStore';
import type { ShizukuState } from '../utils/shizuku';

/**
 * The three permissions the wizard requests as independent OS dialogs
 * (accessibility is guide-only and therefore not part of this union).
 */
export type RequestablePermission = 'notifications' | 'camera' | 'microphone';

export const REQUESTABLE_PERMISSIONS: readonly RequestablePermission[] = [
  'notifications',
  'camera',
  'microphone',
];

/**
 * Full onboarding set tracked by the wizard (#556). Accessibility is
 * guide-only — no OS dialog — but its outcome is persisted by the wizard on
 * step finish, so it stays in the banner list for the denied path.
 */
export const ONBOARDING_PERMISSIONS: readonly OSPermission[] = [
  'notifications',
  'camera',
  'microphone',
  'accessibility',
];

/**
 * Permissions that count as "missing" after setup for the persistent
 * "finish setup later" banner in chat (client/app/index.tsx).
 *
 * - notifications: anything not granted counts — 'undetermined' here means
 *   "never asked", which is dismissible (granting via Settings → Permissions
 *   flips it granted, and the _layout polling effect re-checks on foreground).
 * - camera / microphone / accessibility: explicit denial only. They can stay
 *   'undetermined' forever on builds without expo-camera / expo-av (optional
 *   deps not shipped) or without the accessibility native module, so keying
 *   the banner on undetermined would keep it on screen permanently.
 */
export function getMissingSetupPermissions(
  osPermissions: Record<OSPermission, OSPermissionStatus>
): OSPermission[] {
  return ONBOARDING_PERMISSIONS.filter((perm) => {
    const status = osPermissions[perm];
    if (perm === 'notifications') {
      return status !== 'granted';
    }
    return status === 'denied';
  });
}

// ---------------------------------------------------------------------------
// #557: integration gaps in the "finish setup later" banner
// ---------------------------------------------------------------------------
export interface SetupIntegrationSnapshot {
  connectionMode: string;
  googlePending: boolean;
  googleConnected: boolean;
  shizukuState: string;
}

export type MissingSetupIntegration =
  | { kind: 'google' }
  | { kind: 'shizuku'; state: ShizukuState };

export function getMissingSetupIntegrations(
  snapshot: SetupIntegrationSnapshot
): MissingSetupIntegration[] {
  const result: MissingSetupIntegration[] = [];

  // Google Workspace is a server-mode-only integration.
  if (
    snapshot.connectionMode === 'server' &&
    snapshot.googlePending &&
    !snapshot.googleConnected
  ) {
    result.push({ kind: 'google' });
  }

  // Shizuku surfaces concrete non-ready states only.
  const shizukuState = snapshot.shizukuState;
  if (
    shizukuState === 'app_missing' ||
    shizukuState === 'server_stopped' ||
    shizukuState === 'permission_denied'
  ) {
    result.push({ kind: 'shizuku', state: shizukuState as ShizukuState });
  }

  return result;
}
