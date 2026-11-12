// #557: the wizard's Shizuku integration step must map every deriveShizukuState
// outcome (plus 'unknown' = status unreadable) to honest step messaging and the
// actions that state offers. Pure mapping — no react-native here.
import {
  SHIZUKU_SETUP_GUIDE,
  deriveShizukuState,
} from '../utils/shizuku';

describe('SHIZUKU_SETUP_GUIDE (#557 wizard step)', () => {
  it('covers every derived state plus unknown', () => {
    const states: (keyof typeof SHIZUKU_SETUP_GUIDE)[] = [
      'app_missing',
      'server_stopped',
      'permission_denied',
      'ready',
      'unknown',
    ];
    for (const state of states) {
      const guide = SHIZUKU_SETUP_GUIDE[state];
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.body.length).toBeGreaterThan(0);
      expect(Array.isArray(guide.actions)).toBe(true);
    }
  });

  it('app_missing offers install (with recheck) and says the app is missing', () => {
    const guide = SHIZUKU_SETUP_GUIDE.app_missing;
    expect(guide.actions).toContain('install');
    expect(guide.actions).toContain('recheck');
    expect(guide.body.toLowerCase()).toContain('install');
  });

  it('server_stopped tells the user to start the server, recheck only', () => {
    const guide = SHIZUKU_SETUP_GUIDE.server_stopped;
    expect(guide.actions).toEqual(['recheck']);
    expect(guide.body.toLowerCase()).toContain('start');
  });

  it('permission_denied offers requesting permission', () => {
    const guide = SHIZUKU_SETUP_GUIDE.permission_denied;
    expect(guide.actions).toContain('request_permission');
    expect(guide.actions).toContain('recheck');
  });

  it('ready needs no setup action beyond recheck', () => {
    expect(SHIZUKU_SETUP_GUIDE.ready.actions).toEqual(['recheck']);
  });

  it('unknown never asks for install/request — status could not be read', () => {
    const guide = SHIZUKU_SETUP_GUIDE.unknown;
    expect(guide.actions).toEqual(['recheck']);
    expect(guide.body).toMatch(/later|Settings/i);
  });

  it('stays consistent with deriveShizukuState outcomes', () => {
    // Any state the wizard can observe must have a guide entry.
    for (const status of [
      { installed: false, serverRunning: false, permissionGranted: false },
      { installed: true, serverRunning: false, permissionGranted: false },
      { installed: true, serverRunning: true, permissionGranted: false },
      { installed: true, serverRunning: true, permissionGranted: true },
    ]) {
      expect(SHIZUKU_SETUP_GUIDE[deriveShizukuState(status)]).toBeDefined();
    }
  });
});
