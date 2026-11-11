// ---------------------------------------------------------------------------
// Onboarding permission set (#556)
//
// The setup wizard's permissions step asks for notifications, camera and
// microphone via independent OS dialogs, and offers accessibility through
// AccessibilityGuide. Storage/background/phone/contacts are intentionally
// excluded — inert or point-of-use only.
// ---------------------------------------------------------------------------
import type { OSPermission, OSPermissionStatus } from '../store/useConfigStore';

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
 * Only explicit denial counts. 'undetermined' means never asked or not
 * determinable on this build (expo-camera / expo-av are optional deps not
 * shipped), so keying the banner on undetermined would keep it on screen
 * forever. The Settings → Permissions hub remains the place to resolve those.
 */
export function getMissingSetupPermissions(
  osPermissions: Record<OSPermission, OSPermissionStatus>
): OSPermission[] {
  return ONBOARDING_PERMISSIONS.filter((perm) => osPermissions[perm] === 'denied');
}
