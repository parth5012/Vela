import { ensureStandaloneRunner } from './helpers/standaloneRunner';
import { classifyAction } from '../utils/safetyManager';

ensureStandaloneRunner();

/**
 * Shizuku allowlisted tools must land in an explicit permission tier, never in
 * the default 'tap' bucket — a privileged command silently inheriting the
 * lowest-risk tier would bypass the Owner's policy screen.
 */
describe('classifyAction: Shizuku allowlisted tools', () => {
  it('maps permission grant/revoke to permission_toggles', () => {
    expect(
      classifyAction('device_app_permission_grant', 'com.example.app', 'android.permission.CAMERA')
    ).toBe('permission_toggles');
    expect(
      classifyAction('device_app_permission_revoke', 'com.example.app', 'android.permission.CAMERA')
    ).toBe('permission_toggles');
  });

  it('maps settings writes to settings_changes', () => {
    expect(classifyAction('device_setting_put', 'secure/font_scale', '1.2')).toBe(
      'settings_changes'
    );
  });

  it('maps force-stop and app enable/disable to root_shizuku', () => {
    expect(classifyAction('device_app_force_stop', 'com.example.app')).toBe('root_shizuku');
    expect(classifyAction('device_app_set_state', 'com.example.app', 'disabled')).toBe(
      'root_shizuku'
    );
  });

  it('maps clear-data to deletions', () => {
    expect(classifyAction('device_app_clear_data', 'com.example.app')).toBe('deletions');
  });

  it('maps install/uninstall to sideloads', () => {
    expect(classifyAction('device_app_install', '/sdcard/Download/app.apk')).toBe('sideloads');
    expect(classifyAction('device_app_uninstall', 'com.example.app')).toBe('sideloads');
  });

  it('never falls through to the default tap bucket', () => {
    const privileged = [
      'device_app_permission_grant',
      'device_app_permission_revoke',
      'device_setting_put',
      'device_app_force_stop',
      'device_app_set_state',
      'device_app_clear_data',
      'device_app_install',
      'device_app_uninstall',
    ];
    for (const tool of privileged) {
      expect(classifyAction(tool, 'com.example.app', 'value')).not.toBe('tap');
    }
  });
});
