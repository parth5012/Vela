import { executeDeviceAction, abortDeviceAction } from '../utils/deviceActionExecutor';
import { useDeviceSessionStore } from '../store/useDeviceSessionStore';
import { Platform } from 'react-native';

const mockHolder: { mod: any } = { mod: null };

jest.mock('../modules/device-agent', () => ({
  __esModule: true,
  get default() {
    return mockHolder.mod;
  },
}));

jest.mock('../db/client', () => ({ db: null }));

describe('Kill Switch & Emergency Abort Integration', () => {
  const platform = Platform as unknown as { OS: string };
  const originalOS = platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    platform.OS = 'android';
    useDeviceSessionStore.getState().resetSession();
    mockHolder.mod = {
      performAction: jest.fn().mockResolvedValue(true),
      getScreenTree: jest.fn().mockResolvedValue('{}'),
    };
  });

  afterAll(() => {
    platform.OS = originalOS;
  });

  it('records executed action into session history', async () => {
    const res = await executeDeviceAction('device_tap', '@e1', 'click');
    expect(res.outcome).toBe('executed');

    const history = useDeviceSessionStore.getState().actionHistory;
    expect(history.length).toBe(1);
    expect(history[0].toolName).toBe('device_tap');
    expect(history[0].target).toBe('@e1');
    expect(history[0].outcome).toBe('executed');
  });

  it('aborts execution immediately when kill switch is triggered', async () => {
    // Trigger emergency kill switch
    abortDeviceAction('volume_key');

    expect(useDeviceSessionStore.getState().killSwitchTriggered).toBe(true);
    expect(useDeviceSessionStore.getState().killSwitchSource).toBe('volume_key');

    // Attempting to execute action returns aborted failure without invoking native module
    const res = await executeDeviceAction('device_tap', '@e2', 'click');
    expect(res.outcome).toBe('failed');
    expect(res.observation).toContain('aborted by emergency kill switch');
    expect(mockHolder.mod.performAction).not.toHaveBeenCalled();
  });

  it('keeps kill switch guard active until pending native call settles, and records indeterminate for mutating in-flight action', async () => {
    let resolveNativeCall: (val: any) => void = () => {};
    mockHolder.mod.performAction = jest.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        resolveNativeCall = resolve;
      });
    });

    // Start executing an action (mutating device_tap)
    const actionPromise = executeDeviceAction('device_tap', '@e3', 'click');

    // While the native action is pending, verify automation and pending work are active
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(true);
    expect(useDeviceSessionStore.getState().hasPendingWork).toBe(true);

    // User triggers kill switch mid-flight
    abortDeviceAction('floating_button');
    expect(useDeviceSessionStore.getState().killSwitchTriggered).toBe(true);
    expect(useDeviceSessionStore.getState().hasPendingWork).toBe(true);

    // Attempting to reset kill switch while pending work is active should be blocked
    useDeviceSessionStore.getState().resetKillSwitch();
    expect(useDeviceSessionStore.getState().killSwitchTriggered).toBe(true);

    // Now resolve the in-flight native call
    resolveNativeCall(true);
    const res = await actionPromise;

    // Mutating action in-flight should report indeterminate outcome reflecting actual device state
    expect(res.outcome).toBe('indeterminate');
    expect(res.observation).toContain('kill switch');

    // Verify session history recorded the indeterminate outcome
    const history = useDeviceSessionStore.getState().actionHistory;
    expect(history.length).toBe(1);
    expect(history[0].outcome).toBe('indeterminate');

    // After pending work has settled, pending work is false
    expect(useDeviceSessionStore.getState().hasPendingWork).toBe(false);
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(false);

    // Now kill switch can be safely reset
    useDeviceSessionStore.getState().resetKillSwitch();
    expect(useDeviceSessionStore.getState().killSwitchTriggered).toBe(false);
  });
});
