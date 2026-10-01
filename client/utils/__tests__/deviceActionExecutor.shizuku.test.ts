import { executeDeviceAction } from '../deviceActionExecutor';
import { Platform } from 'react-native';

// Same holder pattern as deviceActionExecutor.test.ts (#308): each test flips
// native availability without re-mocking the module factory.
const mockHolder: { mod: any } = { mod: null };

jest.mock('../../modules/device-agent', () => ({
  __esModule: true,
  get default() {
    return mockHolder.mod;
  },
}));

jest.mock('../../db/client', () => ({ db: null }));

const READY_STATUS = {
  installed: true,
  serverRunning: true,
  permissionGranted: true,
  uid: 2000,
};

function readyModule(overrides: any = {}) {
  return {
    getShizukuStatus: jest.fn().mockResolvedValue(READY_STATUS),
    requestShizukuPermission: jest.fn().mockResolvedValue('requested'),
    runPrivilegedOp: jest.fn().mockResolvedValue('exit=0\n'),
    getScreenTree: jest.fn().mockResolvedValue('tree'),
    ...overrides,
  };
}

describe('executeDeviceAction: Shizuku allowlisted ops', () => {
  const platform = Platform as unknown as { OS: string };
  const originalOS = platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    platform.OS = 'android';
    mockHolder.mod = null;
  });

  afterAll(() => {
    platform.OS = originalOS;
  });

  it('reports unavailable and does NOT dispatch when the module lacks runPrivilegedOp', async () => {
    mockHolder.mod = { getScreenTree: jest.fn(), performAction: jest.fn() };

    const result = await executeDeviceAction('device_app_force_stop', 'com.a');

    expect(result.outcome).toBe('unavailable');
    expect(result.observation.toLowerCase()).toContain('not executed');
    expect(result.observation).toContain('runPrivilegedOp');
  });

  it('reports unavailable without dispatching when the Shizuku app is not installed', async () => {
    mockHolder.mod = readyModule({
      getShizukuStatus: jest
        .fn()
        .mockResolvedValue({ installed: false, serverRunning: false, permissionGranted: false }),
    });

    const result = await executeDeviceAction('device_app_force_stop', 'com.a');

    expect(result.outcome).toBe('unavailable');
    expect(result.observation.toLowerCase()).toContain('not executed');
    expect(result.observation).toMatch(/shizuku setup/i);
    expect(mockHolder.mod.runPrivilegedOp).not.toHaveBeenCalled();
  });

  it('reports unavailable without dispatching when the server is stopped', async () => {
    mockHolder.mod = readyModule({
      getShizukuStatus: jest
        .fn()
        .mockResolvedValue({ installed: true, serverRunning: false, permissionGranted: false }),
    });

    const result = await executeDeviceAction('device_setting_put', 'secure/font_scale', '1.2');

    expect(result.outcome).toBe('unavailable');
    expect(mockHolder.mod.runPrivilegedOp).not.toHaveBeenCalled();
  });

  it('reports unavailable without dispatching when permission is not granted', async () => {
    mockHolder.mod = readyModule({
      getShizukuStatus: jest
        .fn()
        .mockResolvedValue({ installed: true, serverRunning: true, permissionGranted: false }),
    });

    const result = await executeDeviceAction('device_app_permission_grant', 'com.a', 'android.permission.CAMERA');

    expect(result.outcome).toBe('unavailable');
    expect(mockHolder.mod.runPrivilegedOp).not.toHaveBeenCalled();
  });

  it('dispatches the allowlisted op with the right arguments and reports executed on exit=0', async () => {
    mockHolder.mod = readyModule({
      runPrivilegedOp: jest.fn().mockResolvedValue('exit=0\nSuccess: granted'),
    });

    const result = await executeDeviceAction(
      'device_app_permission_grant',
      'com.a',
      'android.permission.CAMERA'
    );

    expect(mockHolder.mod.runPrivilegedOp).toHaveBeenCalledWith('pm_grant', [
      'com.a',
      'android.permission.CAMERA',
    ]);
    expect(result.outcome).toBe('executed');
    expect(result.observation).toContain('Success: granted');
  });

  it('splits the settings target into namespace, key and value', async () => {
    mockHolder.mod = readyModule();

    await executeDeviceAction('device_setting_put', 'secure/font_scale', '1.2');

    expect(mockHolder.mod.runPrivilegedOp).toHaveBeenCalledWith('settings_put', [
      'secure',
      'font_scale',
      '1.2',
    ]);
  });

  it('reports failed with the command output when the op exits non-zero', async () => {
    mockHolder.mod = readyModule({
      runPrivilegedOp: jest.fn().mockResolvedValue('exit=10\nFailure: not allowed'),
    });

    const result = await executeDeviceAction('device_app_force_stop', 'com.a');

    expect(result.outcome).toBe('failed');
    expect(result.observation).toContain('Failure: not allowed');
    expect(result.observation).not.toMatch(/Executed/);
  });

  it('reports failed WITHOUT dispatching when the op arguments are malformed', async () => {
    mockHolder.mod = readyModule();

    const result = await executeDeviceAction('device_setting_put', 'font_scale', '1.2');

    expect(result.outcome).toBe('failed');
    expect(result.observation.toLowerCase()).toContain('not dispatched');
    expect(mockHolder.mod.runPrivilegedOp).not.toHaveBeenCalled();
  });

  it('reports indeterminate when runPrivilegedOp throws after dispatch', async () => {
    mockHolder.mod = readyModule({
      runPrivilegedOp: jest.fn().mockRejectedValue(new Error('binder died')),
    });

    const result = await executeDeviceAction('device_app_uninstall', 'com.a');

    expect(result.outcome).toBe('indeterminate');
    expect(result.observation).toContain('UNKNOWN');
    expect(result.observation).toContain('before repeating');
  });

  it('reports failed, nothing dispatched, when the status check itself throws', async () => {
    mockHolder.mod = readyModule({
      getShizukuStatus: jest.fn().mockRejectedValue(new Error('provider missing')),
    });

    const result = await executeDeviceAction('device_app_force_stop', 'com.a');

    expect(result.outcome).toBe('failed');
    expect(result.observation.toLowerCase()).toContain('not executed');
    expect(mockHolder.mod.runPrivilegedOp).not.toHaveBeenCalled();
  });

  it('never asks for Shizuku status on non-Shizuku tools', async () => {
    mockHolder.mod = readyModule();

    const result = await executeDeviceAction('device_screen_read');

    expect(result.outcome).toBe('executed');
    expect(mockHolder.mod.getShizukuStatus).not.toHaveBeenCalled();
  });
});
