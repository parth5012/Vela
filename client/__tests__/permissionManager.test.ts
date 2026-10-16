import fs from 'fs';
import path from 'path';
import { Linking, Platform } from 'react-native';
import {
  checkPermission,
  requestPermission,
  buildSettingsDeepLink,
  getRationale,
  checkAllPermissions,
  shouldPrompt,
  openSettings,
  canOpenSettingsAction,
  APP_PERMISSIONS,
  type OSPermission,
} from '../utils/permissionManager';
import { useConfigStore } from '../store/useConfigStore';

describe('permissionManager', () => {
  describe('OSPermission union and defaults', () => {
    it('covers all expected permissions in APP_PERMISSIONS metadata', () => {
      const perms = APP_PERMISSIONS.map((p) => p.perm);
      expect(perms).toContain('notifications');
      expect(perms).toContain('camera');
      expect(perms).toContain('microphone');
      expect(perms).toContain('storage');
      expect(perms).toContain('accessibility');
      expect(perms).toContain('background');
      expect(perms).toContain('phone');
      expect(perms).toContain('contacts');
      // Capability honesty: there must be NO SMS runtime permission entry
      expect(perms).not.toContain('sms' as any);
      expect(perms.length).toBe(8);
    });

    it('initializes store osPermissions defaults with phone and contacts', () => {
      const storePerms = useConfigStore.getState().osPermissions;
      expect(storePerms.phone).toBe('undetermined');
      expect(storePerms.contacts).toBe('undetermined');
      expect(storePerms.storage).toBe('granted');
      expect(storePerms.notifications).toBe('undetermined');
    });

    it('resets osPermissions to defaults on clearConfig', () => {
      useConfigStore.getState().setOSPermission('phone', 'granted');
      expect(useConfigStore.getState().osPermissions.phone).toBe('granted');
      useConfigStore.getState().clearConfig();
      expect(useConfigStore.getState().osPermissions.phone).toBe('undetermined');
      expect(useConfigStore.getState().osPermissions.contacts).toBe('undetermined');
    });
  });

  describe('checkPermission', () => {
    it('returns granted for modern scoped storage without prompt', async () => {
      const status = await checkPermission('storage');
      expect(status).toBe('granted');
    });

    it('returns honest undetermined for phone when native module lacks method or is mocked/absent', async () => {
      const status = await checkPermission('phone');
      expect(status).toBe('undetermined');
    });

    it('returns honest undetermined for contacts when native module lacks method or is mocked/absent', async () => {
      const status = await checkPermission('contacts');
      expect(status).toBe('undetermined');
    });

    it('returns honest undetermined for background on this OS version', async () => {
      const status = await checkPermission('background');
      expect(status).toBe('undetermined');
    });
  });

  describe('requestPermission', () => {
    it('returns undetermined and routes to settings for permissions lacking direct request dialog', async () => {
      const status = await requestPermission('phone');
      expect(status).toBe('undetermined');
    });
  });

  describe('getRationale', () => {
    it('provides honest privacy rationale for phone and contacts without marketing text', () => {
      const phoneRat = getRationale('phone');
      const contactsRat = getRationale('contacts');
      expect(phoneRat).toContain('phone calls');
      expect(contactsRat).toContain('contacts');
    });
  });

  describe('buildSettingsDeepLink', () => {
    it('returns ACCESSIBILITY_SETTINGS for accessibility', () => {
      expect(buildSettingsDeepLink('accessibility')).toBe('android.settings.ACCESSIBILITY_SETTINGS');
    });

    it('returns MANAGE_OVERLAY_PERMISSION for overlay', () => {
      expect(buildSettingsDeepLink('overlay')).toBe('android.settings.action.MANAGE_OVERLAY_PERMISSION');
    });

    it('returns APPLICATION_DETAILS_SETTINGS for restricted_settings and per-app targets', () => {
      expect(buildSettingsDeepLink('restricted_settings')).toBe('android.settings.APPLICATION_DETAILS_SETTINGS');
      expect(buildSettingsDeepLink('phone')).toBe('android.settings.APPLICATION_DETAILS_SETTINGS');
      expect(buildSettingsDeepLink('contacts')).toBe('android.settings.APPLICATION_DETAILS_SETTINGS');
    });
  });

  describe('checkAllPermissions', () => {
    it('checks all 8 permissions and aggregates status record', async () => {
      const all = await checkAllPermissions();
      const keys = Object.keys(all) as OSPermission[];
      expect(keys.length).toBe(8);
      expect(all.storage).toBe('granted');
      expect(all.phone).toBe('undetermined');
      expect(all.contacts).toBe('undetermined');
    });
  });

  describe('shouldPrompt', () => {
    it('respects session-denied sets correctly', () => {
      const denied = new Set<OSPermission>(['phone']);
      expect(shouldPrompt('phone', denied)).toBe(false);
      expect(shouldPrompt('contacts', denied)).toBe(true);
    });
  });

  describe('Finding 2: hardcoded package id guard', () => {
    it('asserts no hardcoded com.parth5012 or package: literal remains in permissionManager.ts', () => {
      // Arrange
      const filePath = path.resolve(__dirname, '../utils/permissionManager.ts');

      // Act
      const source = fs.readFileSync(filePath, 'utf8');

      // Assert
      expect(source).not.toContain('com.parth5012');
      expect(source).not.toContain('package:');
      expect(source).not.toContain('expo-intent-launcher');
    });
  });

  describe('Finding 1: openSettings capability guard and non-degradation', () => {
    it('returns failure with capability guard message when openSettings("overlay") is called without native method', async () => {
      // Arrange
      Platform.OS = 'android';
      const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockClear();

      // Act
      const result = await openSettings('overlay');

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/the module does not provide openSettingsAction\(\)|DeviceAgentModule did not load/);
      expect(openSettingsSpy).not.toHaveBeenCalled();
    });

    it('canOpenSettingsAction returns false when native module lacks openSettingsAction', () => {
      // Arrange
      Platform.OS = 'android';

      // Act
      const canOpen = canOpenSettingsAction();

      // Assert
      expect(canOpen).toBe(false);
    });

    it('opens application details settings for restricted_settings via Linking.openSettings', async () => {
      // Arrange
      const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValueOnce();

      // Act
      const result = await openSettings('restricted_settings');

      // Assert
      expect(result.success).toBe(true);
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    });
  });
});
