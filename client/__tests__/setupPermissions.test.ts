// #556: onboarding permission set + "finish setup later" banner logic.
import {
  ONBOARDING_PERMISSIONS,
  REQUESTABLE_PERMISSIONS,
  getMissingSetupPermissions,
} from '../utils/setupPermissions';
import type { OSPermission, OSPermissionStatus } from '../store/useConfigStore';

const storeWith = (
  overrides: Partial<Record<OSPermission, OSPermissionStatus>> = {}
): Record<OSPermission, OSPermissionStatus> => ({
  notifications: 'undetermined',
  camera: 'undetermined',
  microphone: 'undetermined',
  storage: 'granted',
  accessibility: 'undetermined',
  background: 'undetermined',
  phone: 'undetermined',
  contacts: 'undetermined',
  ...overrides,
});

describe('setupPermissions (#556)', () => {
  describe('ONBOARDING_PERMISSIONS', () => {
    it('asks exactly notifications, camera, microphone and accessibility', () => {
      expect(ONBOARDING_PERMISSIONS).toEqual([
        'notifications',
        'camera',
        'microphone',
        'accessibility',
      ]);
    });

    it('does NOT ask storage/background/phone/contacts (inert or point-of-use only)', () => {
      expect(ONBOARDING_PERMISSIONS).not.toContain('storage');
      expect(ONBOARDING_PERMISSIONS).not.toContain('background');
      expect(ONBOARDING_PERMISSIONS).not.toContain('phone');
      expect(ONBOARDING_PERMISSIONS).not.toContain('contacts');
    });

    it('exposes the three independently-requested OS dialogs in canonical order', () => {
      // Accessibility is guide-only (not an OS dialog) and therefore not in
      // the requestable list.
      expect(REQUESTABLE_PERMISSIONS).toEqual([
        'notifications',
        'camera',
        'microphone',
      ]);
      expect(REQUESTABLE_PERMISSIONS).not.toContain('accessibility' as any);
    });
  });

  describe('getMissingSetupPermissions', () => {
    it('returns empty when everything requested is granted', () => {
      const store = storeWith({
        notifications: 'granted',
        camera: 'granted',
        microphone: 'granted',
        accessibility: 'granted',
      });
      expect(getMissingSetupPermissions(store)).toEqual([]);
    });

    it('flags explicitly denied permissions as missing', () => {
      const store = storeWith({
        notifications: 'granted',
        microphone: 'denied',
      });
      expect(getMissingSetupPermissions(store)).toEqual(['microphone']);
    });

    it('returns every denied onboarding permission in canonical order', () => {
      const store = storeWith({
        notifications: 'denied',
        camera: 'denied',
        microphone: 'denied',
        accessibility: 'denied',
        phone: 'denied', // not part of onboarding — must not appear
        contacts: 'denied',
      });
      expect(getMissingSetupPermissions(store)).toEqual([
        'notifications',
        'camera',
        'microphone',
        'accessibility',
      ]);
    });

    it('flags notifications as missing when only ever asked-not / undetermined', () => {
      // Notifications is dismissible — granting via Settings → Permissions
      // flips it to granted (the _layout polling effect re-checks on
      // foreground), so 'undetermined' (never asked) must surface on the
      // banner instead of silently disappearing.
      const store = storeWith({ notifications: 'undetermined' });
      expect(getMissingSetupPermissions(store)).toEqual(['notifications']);
    });

    it('does not flag camera/microphone/accessibility as undetermined (never dismissible)', () => {
      // expo-camera and expo-av are optional deps not shipped in this build, so
      // camera/microphone can stay 'undetermined' forever; a banner keyed on
      // undetermined would never dismiss. Accessibility is guide-only — same
      // honesty applies when the native module cannot determine the service.
      // Only explicit denial counts for these three.
      const store = storeWith({
        camera: 'undetermined',
        microphone: 'undetermined',
        accessibility: 'undetermined',
        notifications: 'granted',
      });
      expect(getMissingSetupPermissions(store)).toEqual([]);
    });
  });
});
