// #556: onboarding permission set + "finish setup later" banner logic.
import {
  ONBOARDING_PERMISSIONS,
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

    it('does not flag undetermined (never asked / not determinable on this build)', () => {
      // expo-camera and expo-av are optional deps not shipped in this build, so
      // camera/microphone can stay 'undetermined' forever; a banner keyed on
      // undetermined would never dismiss. Only explicit denial counts.
      const store = storeWith(); // everything undetermined
      expect(getMissingSetupPermissions(store)).toEqual([]);
    });
  });
});
