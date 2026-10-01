import {
  SHIZUKU_TOOLS,
  isShizukuTool,
  deriveShizukuState,
  describeShizukuState,
  buildShizukuOp,
} from '../shizuku';

describe('shizuku tool registry', () => {
  it('lists exactly the eight allowlisted privileged tools', () => {
    expect([...SHIZUKU_TOOLS].sort()).toEqual(
      [
        'device_app_clear_data',
        'device_app_force_stop',
        'device_app_install',
        'device_app_permission_grant',
        'device_app_permission_revoke',
        'device_app_set_state',
        'device_app_uninstall',
        'device_setting_put',
      ].sort()
    );
  });

  it('recognises shizuku tools and rejects everything else', () => {
    expect(isShizukuTool('device_app_force_stop')).toBe(true);
    expect(isShizukuTool('device_tap')).toBe(false);
    expect(isShizukuTool('device_screen_read')).toBe(false);
    expect(isShizukuTool('webview_browser')).toBe(false);
  });
});

describe('deriveShizukuState', () => {
  const granted = { installed: true, serverRunning: true, permissionGranted: true };

  it('is ready only when installed, running and granted', () => {
    expect(deriveShizukuState(granted)).toBe('ready');
  });

  it('ranks missing app above stopped server above missing permission', () => {
    expect(deriveShizukuState({ installed: false, serverRunning: false, permissionGranted: false })).toBe(
      'app_missing'
    );
    expect(deriveShizukuState({ installed: true, serverRunning: false, permissionGranted: false })).toBe(
      'server_stopped'
    );
    expect(deriveShizukuState({ installed: true, serverRunning: true, permissionGranted: false })).toBe(
      'permission_denied'
    );
  });

  it('treats a live server as authoritative even without the manager app (Sui/root)', () => {
    expect(deriveShizukuState({ installed: false, serverRunning: true, permissionGranted: true })).toBe(
      'ready'
    );
    expect(deriveShizukuState({ installed: false, serverRunning: true, permissionGranted: false })).toBe(
      'permission_denied'
    );
  });

  it('describes every state for the Owner', () => {
    expect(describeShizukuState('app_missing')).toMatch(/install/i);
    expect(describeShizukuState('server_stopped')).toMatch(/start/i);
    expect(describeShizukuState('permission_denied')).toMatch(/permission/i);
    expect(describeShizukuState('ready')).toMatch(/ready/i);
  });
});

describe('buildShizukuOp', () => {
  it('maps permission tools to pm grant/revoke with package and permission', () => {
    expect(buildShizukuOp('device_app_permission_grant', 'com.a', 'android.permission.CAMERA')).toEqual({
      op: 'pm_grant',
      args: ['com.a', 'android.permission.CAMERA'],
    });
    expect(buildShizukuOp('device_app_permission_revoke', 'com.a', 'android.permission.CAMERA')).toEqual({
      op: 'pm_revoke',
      args: ['com.a', 'android.permission.CAMERA'],
    });
  });

  it('splits device_setting_put target into namespace/key plus value', () => {
    expect(buildShizukuOp('device_setting_put', 'secure/font_scale', '1.2')).toEqual({
      op: 'settings_put',
      args: ['secure', 'font_scale', '1.2'],
    });
    expect(buildShizukuOp('device_setting_put', 'system/screen_off_timeout', '30000')).toEqual({
      op: 'settings_put',
      args: ['system', 'screen_off_timeout', '30000'],
    });
  });

  it('rejects a settings target without a namespace', () => {
    expect(buildShizukuOp('device_setting_put', 'font_scale', '1.2')).toBeNull();
    expect(buildShizukuOp('device_setting_put', '/font_scale', '1.2')).toBeNull();
  });

  it('maps process and component ops', () => {
    expect(buildShizukuOp('device_app_force_stop', 'com.a')).toEqual({
      op: 'force_stop',
      args: ['com.a'],
    });
    expect(buildShizukuOp('device_app_set_state', 'com.a', 'disabled')).toEqual({
      op: 'set_enabled',
      args: ['com.a', 'disabled'],
    });
    expect(buildShizukuOp('device_app_clear_data', 'com.a')).toEqual({
      op: 'clear_data',
      args: ['com.a'],
    });
    expect(buildShizukuOp('device_app_install', '/sdcard/app.apk')).toEqual({
      op: 'install',
      args: ['/sdcard/app.apk'],
    });
    expect(buildShizukuOp('device_app_uninstall', 'com.a')).toEqual({
      op: 'uninstall',
      args: ['com.a'],
    });
  });

  it('rejects an app state that is not enabled/disabled', () => {
    expect(buildShizukuOp('device_app_set_state', 'com.a', 'sideloaded')).toBeNull();
    expect(buildShizukuOp('device_app_set_state', 'com.a')).toBeNull();
  });

  it('returns null for tools outside the allowlist', () => {
    expect(buildShizukuOp('device_tap', '500,1000')).toBeNull();
    expect(buildShizukuOp('device_screen_read')).toBeNull();
  });
});
