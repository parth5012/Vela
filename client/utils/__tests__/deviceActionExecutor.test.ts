import { executeDeviceAction } from '../deviceActionExecutor';
import { Platform } from 'react-native';

// #308: the native module may legitimately be null (PR #300 made
// requireNativeModule failure non-fatal). The holder is read through a getter
// so each test can flip availability without re-mocking the module.
const mockHolder: { mod: any } = { mod: null };

jest.mock('../../modules/device-agent', () => ({
  __esModule: true,
  get default() {
    return mockHolder.mod;
  },
}));

jest.mock('../../db/client', () => ({ db: null }));

describe('executeDeviceAction outcomes (#308)', () => {
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

  it('reports unavailable, never executed, when the native module did not load', async () => {
    mockHolder.mod = null;

    const result = await executeDeviceAction('device_screen_read');

    expect(result.outcome).toBe('unavailable');
    expect(result.observation.toLowerCase()).toContain('not executed');
    expect(result.observation).not.toMatch(/\[Fallback\] Executed/);
  });

  it('reports unavailable when the module loaded without the method it needs', async () => {
    mockHolder.mod = {};

    const result = await executeDeviceAction('device_screen_read');

    expect(result.outcome).toBe('unavailable');
    expect(result.observation.toLowerCase()).toContain('not executed');
  });

  it('reports failed, never executed, when the native call throws', async () => {
    mockHolder.mod = {
      getScreenTree: jest.fn().mockRejectedValue(new Error('accessibility off')),
    };

    const result = await executeDeviceAction('device_screen_read');

    expect(result.outcome).toBe('failed');
    expect(result.observation.toLowerCase()).toContain('failed');
    expect(result.observation).not.toMatch(/Executed/);
  });

  it('reports failed when performAction reports the action did not happen', async () => {
    mockHolder.mod = { performAction: jest.fn().mockResolvedValue(false) };

    const result = await executeDeviceAction('device_click', '500,1000');

    expect(result.outcome).toBe('failed');
    expect(result.observation).toBe('Action failed');
  });

  it('reports executed when the native action succeeds', async () => {
    mockHolder.mod = {
      performAction: jest.fn().mockResolvedValue(true),
      getScreenTree: jest.fn().mockResolvedValue('Screen tree: Settings > Wi-Fi'),
    };

    const action = await executeDeviceAction('device_click', '500,1000');
    expect(action.outcome).toBe('executed');
    expect(action.observation).toBe('Success');

    const read = await executeDeviceAction('device_screen_read');
    expect(read.outcome).toBe('executed');
    expect(read.observation).toContain('Settings > Wi-Fi');
  });

  it('reports simulated on a non-android platform, without claiming a real action', async () => {
    mockHolder.mod = null;
    platform.OS = 'ios';

    const result = await executeDeviceAction('device_click', '500,1000');

    expect(result.outcome).toBe('simulated');
    expect(result.observation).toContain('[Mock mode]');
  });
});
