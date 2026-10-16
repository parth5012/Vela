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

  it('reports failed instead of fabricating a path when the screenshot is empty', async () => {
    mockHolder.mod = { takeScreenshot: jest.fn().mockResolvedValue('') };

    const result = await executeDeviceAction('device_screenshot');

    expect(result.outcome).toBe('failed');
    expect(result.observation).toContain('screenshot');
    expect(result.observation).not.toContain('file://mock/screenshot.png');
    expect(result.observation).not.toMatch(/Executed/);
  });

  it('reports indeterminate when a mutating action throws after being dispatched', async () => {
    mockHolder.mod = { performAction: jest.fn().mockRejectedValue(new Error('bridge died')) };

    const result = await executeDeviceAction('device_click', '500,1000');

    expect(result.outcome).toBe('indeterminate');
    expect(result.observation).toContain('UNKNOWN');
    expect(result.observation).toContain('before repeating');
    expect(result.observation).not.toMatch(/Executed/);
    expect(result.observation.toLowerCase()).not.toContain('not executed');
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

  describe('device_call (#377)', () => {
    it('dispatches to makeCall and never calls performAction', async () => {
      const performAction = jest.fn();
      const makeCall = jest.fn().mockResolvedValue({ success: true, message: 'Call placed' });
      mockHolder.mod = { makeCall, performAction };

      const result = await executeDeviceAction('device_call', '+1234567890');

      expect(makeCall).toHaveBeenCalledWith('+1234567890');
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toBe('Call placed');
    });

    it('reports failed pre-dispatch when phone number is missing', async () => {
      const makeCall = jest.fn();
      mockHolder.mod = { makeCall };

      const result = await executeDeviceAction('device_call', '');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('phone number is required');
      expect(makeCall).not.toHaveBeenCalled();
    });

    it('reports unavailable when the module lacks makeCall', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_call', '+1234567890');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide makeCall()');
    });

    it('reports indeterminate when makeCall throws after dispatch', async () => {
      mockHolder.mod = {
        makeCall: jest.fn().mockRejectedValue(new Error('telephony service crash')),
      };

      const result = await executeDeviceAction('device_call', '+1234567890');

      expect(result.outcome).toBe('indeterminate');
      expect(result.observation).toContain('UNKNOWN');
      expect(result.observation).toContain('device_call');
      expect(result.observation).toContain('before repeating');
    });

    it('reports failed when makeCall returns structured failure (e.g. permission absent)', async () => {
      mockHolder.mod = {
        makeCall: jest.fn().mockResolvedValue({
          success: false,
          error: 'Permission android.permission.CALL_PHONE not granted',
        }),
      };

      const result = await executeDeviceAction('device_call', '+1234567890');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('CALL_PHONE not granted');
    });

    it('reports failed when makeCall resolves with no acknowledgement (undefined/null/non-object/missing success)', async () => {
      mockHolder.mod = {
        makeCall: jest.fn().mockResolvedValue(undefined),
      };

      const result = await executeDeviceAction('device_call', '+1234567890');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
      expect(result.observation.toLowerCase()).not.toContain('before repeating');
    });
  });

  describe('device_sms (#377)', () => {
    it('dispatches to sendSms and never calls performAction', async () => {
      const performAction = jest.fn();
      const sendSms = jest.fn().mockResolvedValue({ success: true, message: 'SMS composer opened' });
      mockHolder.mod = { sendSms, performAction };

      const result = await executeDeviceAction('device_sms', '+1234567890', 'Hello there');

      expect(sendSms).toHaveBeenCalledWith('+1234567890', 'Hello there');
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toBe('SMS composer opened');
    });

    it('reports failed pre-dispatch when recipient is missing', async () => {
      const sendSms = jest.fn();
      mockHolder.mod = { sendSms };

      const result = await executeDeviceAction('device_sms', '', 'Hello');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('recipient phone number is required');
      expect(sendSms).not.toHaveBeenCalled();
    });

    it('reports unavailable when the module lacks sendSms', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_sms', '+1234567890', 'Hello');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide sendSms()');
    });

    it('reports indeterminate when sendSms throws after dispatch', async () => {
      mockHolder.mod = {
        sendSms: jest.fn().mockRejectedValue(new Error('activity not found')),
      };

      const result = await executeDeviceAction('device_sms', '+1234567890', 'Hello');

      expect(result.outcome).toBe('indeterminate');
      expect(result.observation).toContain('UNKNOWN');
      expect(result.observation).toContain('device_sms');
      expect(result.observation).toContain('before repeating');
    });

    it('reports failed when sendSms returns structured failure', async () => {
      mockHolder.mod = {
        sendSms: jest.fn().mockResolvedValue({
          success: false,
          error: 'No SMS application available on device',
        }),
      };

      const result = await executeDeviceAction('device_sms', '+1234567890', 'Hello');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('No SMS application available');
    });

    it('reports failed when sendSms resolves with no acknowledgement (undefined/null/non-object/missing success)', async () => {
      mockHolder.mod = {
        sendSms: jest.fn().mockResolvedValue(null),
      };

      const result = await executeDeviceAction('device_sms', '+1234567890', 'Hello');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
      expect(result.observation.toLowerCase()).not.toContain('before repeating');
    });
  });

  describe('device_contact (#377)', () => {
    it('dispatches to searchContacts and never calls performAction', async () => {
      const performAction = jest.fn();
      const searchContacts = jest.fn().mockResolvedValue({
        success: true,
        contacts: [{ name: 'Alice', contactId: '1', lookupKey: 'key1' }],
      });
      mockHolder.mod = { searchContacts, performAction };

      const result = await executeDeviceAction('device_contact', 'Alice');

      expect(searchContacts).toHaveBeenCalledWith('Alice');
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toContain('Alice');
    });

    it('reports executed with honest observation on empty contact results', async () => {
      mockHolder.mod = {
        searchContacts: jest.fn().mockResolvedValue({ success: true, contacts: [] }),
      };

      const result = await executeDeviceAction('device_contact', 'Nobody');

      expect(result.outcome).toBe('executed');
      expect(result.observation).toContain('No contacts found matching "Nobody"');
    });

    it('reports executed with honest observation when searchContacts returns empty array directly', async () => {
      mockHolder.mod = {
        searchContacts: jest.fn().mockResolvedValue([]),
      };

      const result = await executeDeviceAction('device_contact', 'Ghost');

      expect(result.outcome).toBe('executed');
      expect(result.observation).toContain('No contacts found matching "Ghost"');
    });

    it('reports unavailable when the module lacks searchContacts', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_contact', 'Alice');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide searchContacts()');
    });

    it('reports failed (NOT indeterminate) when searchContacts throws because it is read-only', async () => {
      mockHolder.mod = {
        searchContacts: jest.fn().mockRejectedValue(new Error('ContentResolver crash')),
      };

      const result = await executeDeviceAction('device_contact', 'Alice');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('Action failed');
      expect(result.observation).not.toContain('UNKNOWN');
      expect(result.observation).not.toContain('before repeating');
    });

    it('reports failed when searchContacts returns structured failure (e.g. permission missing)', async () => {
      mockHolder.mod = {
        searchContacts: jest.fn().mockResolvedValue({
          success: false,
          error: 'Permission android.permission.READ_CONTACTS not granted',
        }),
      };

      const result = await executeDeviceAction('device_contact', 'Alice');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('READ_CONTACTS not granted');
    });

    it('reports failed when searchContacts resolves with no acknowledgement (undefined/non-object/missing success)', async () => {
      mockHolder.mod = {
        searchContacts: jest.fn().mockResolvedValue(undefined),
      };

      const result = await executeDeviceAction('device_contact', 'Alice');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
    });
  });

  describe('device_set_alarm (#378)', () => {
    it('dispatches to setAlarm and never calls performAction', async () => {
      const performAction = jest.fn();
      const setAlarm = jest.fn().mockResolvedValue({ success: true, message: 'Alarm set for 07:30' });
      mockHolder.mod = { setAlarm, performAction };

      const result = await executeDeviceAction('device_set_alarm', '07:30', 'Wake up');

      expect(setAlarm).toHaveBeenCalledWith(7, 30, 'Wake up', true);
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toBe('Alarm set for 07:30');
    });

    it('dispatches to setTimer when timer parameters are supplied', async () => {
      const performAction = jest.fn();
      const setAlarm = jest.fn();
      const setTimer = jest.fn().mockResolvedValue({ success: true, message: 'Timer set for 300 seconds' });
      mockHolder.mod = { setAlarm, setTimer, performAction };

      const result = await executeDeviceAction('device_set_alarm', 'timer:300', 'Boil pasta');

      expect(setTimer).toHaveBeenCalledWith(300, 'Boil pasta', true);
      expect(setAlarm).not.toHaveBeenCalled();
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toBe('Timer set for 300 seconds');
    });

    it('reports failed pre-dispatch when alarm time format is invalid', async () => {
      const setAlarm = jest.fn();
      mockHolder.mod = { setAlarm };

      const result = await executeDeviceAction('device_set_alarm', 'not-a-time');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('valid alarm time');
      expect(setAlarm).not.toHaveBeenCalled();
    });

    it('reports failed pre-dispatch when hour or minute is out of bounds', async () => {
      const setAlarm = jest.fn();
      mockHolder.mod = { setAlarm };

      const result = await executeDeviceAction('device_set_alarm', '25:99');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('hour must be 0-23 and minutes 0-59');
      expect(setAlarm).not.toHaveBeenCalled();
    });

    it('reports unavailable when the module lacks setAlarm', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_set_alarm', '07:30');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide setAlarm()');
    });

    it('reports indeterminate when setAlarm throws after dispatch', async () => {
      mockHolder.mod = {
        setAlarm: jest.fn().mockRejectedValue(new Error('alarm manager crash')),
      };

      const result = await executeDeviceAction('device_set_alarm', '07:30');

      expect(result.outcome).toBe('indeterminate');
      expect(result.observation).toContain('UNKNOWN');
      expect(result.observation).toContain('device_set_alarm');
      expect(result.observation).toContain('before repeating');
    });

    it('reports failed when setAlarm returns structured failure', async () => {
      mockHolder.mod = {
        setAlarm: jest.fn().mockResolvedValue({
          success: false,
          error: 'No application available to handle alarm',
        }),
      };

      const result = await executeDeviceAction('device_set_alarm', '07:30');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('No application available to handle alarm');
    });

    it('reports failed when setAlarm resolves with no acknowledgement', async () => {
      mockHolder.mod = {
        setAlarm: jest.fn().mockResolvedValue(null),
      };

      const result = await executeDeviceAction('device_set_alarm', '07:30');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
    });
  });

  describe('device_set_brightness (#378)', () => {
    it('dispatches to setBrightness and never calls performAction', async () => {
      const performAction = jest.fn();
      const setBrightness = jest.fn().mockResolvedValue({ success: true, message: 'Brightness set to 80%' });
      mockHolder.mod = { setBrightness, performAction };

      const result = await executeDeviceAction('device_set_brightness', '80');

      expect(setBrightness).toHaveBeenCalledWith(80);
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toBe('Brightness set to 80%');
    });

    it('reports failed pre-dispatch when brightness percent is out of range', async () => {
      const setBrightness = jest.fn();
      mockHolder.mod = { setBrightness };

      const result = await executeDeviceAction('device_set_brightness', '150');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('brightness percent must be a number between 0 and 100');
      expect(setBrightness).not.toHaveBeenCalled();
    });

    it('reports unavailable when the module lacks setBrightness', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_set_brightness', '50');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide setBrightness()');
    });

    it('reports indeterminate when setBrightness throws after dispatch', async () => {
      mockHolder.mod = {
        setBrightness: jest.fn().mockRejectedValue(new Error('display service crash')),
      };

      const result = await executeDeviceAction('device_set_brightness', '50');

      expect(result.outcome).toBe('indeterminate');
      expect(result.observation).toContain('UNKNOWN');
      expect(result.observation).toContain('device_set_brightness');
      expect(result.observation).toContain('before repeating');
    });

    it('falls back to Shizuku settings_put when native canWrite is false and Shizuku is ready', async () => {
      const performAction = jest.fn();
      const setBrightness = jest.fn().mockResolvedValue({
        success: false,
        canWrite: false,
        error: 'Permission android.permission.WRITE_SETTINGS not granted',
      });
      const getShizukuStatus = jest.fn().mockResolvedValue({
        installed: true,
        serverRunning: true,
        permissionGranted: true,
      });
      const runPrivilegedOp = jest.fn().mockResolvedValue('exit=0\n');
      mockHolder.mod = { setBrightness, getShizukuStatus, runPrivilegedOp, performAction };

      const result = await executeDeviceAction('device_set_brightness', '50');

      expect(setBrightness).toHaveBeenCalledWith(50);
      expect(runPrivilegedOp).toHaveBeenCalledWith('settings_put', ['system', 'screen_brightness', '128']);
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toContain('Brightness set to 50% via Shizuku');
    });

    it('reports honest failure when native canWrite is false and Shizuku is not ready', async () => {
      const setBrightness = jest.fn().mockResolvedValue({
        success: false,
        canWrite: false,
        error: 'Permission android.permission.WRITE_SETTINGS not granted. Grant "Modify system settings".',
      });
      const getShizukuStatus = jest.fn().mockResolvedValue({
        installed: false,
        serverRunning: false,
        permissionGranted: false,
      });
      mockHolder.mod = { setBrightness, getShizukuStatus };

      const result = await executeDeviceAction('device_set_brightness', '50');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('WRITE_SETTINGS not granted');
    });

    it('reports failed when setBrightness resolves with no acknowledgement', async () => {
      mockHolder.mod = {
        setBrightness: jest.fn().mockResolvedValue(undefined),
      };

      const result = await executeDeviceAction('device_set_brightness', '50');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
    });
  });

  describe('device_set_volume (#378)', () => {
    it('dispatches to setVolume and never calls performAction', async () => {
      const performAction = jest.fn();
      const setVolume = jest.fn().mockResolvedValue({ success: true, message: 'Volume set to 60%' });
      mockHolder.mod = { setVolume, performAction };

      const result = await executeDeviceAction('device_set_volume', '60');

      expect(setVolume).toHaveBeenCalledWith(60);
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toBe('Volume set to 60%');
    });

    it('reports failed pre-dispatch when volume percent is out of range', async () => {
      const setVolume = jest.fn();
      mockHolder.mod = { setVolume };

      const result = await executeDeviceAction('device_set_volume', '-5');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('volume percent must be a number between 0 and 100');
      expect(setVolume).not.toHaveBeenCalled();
    });

    it('reports unavailable when the module lacks setVolume', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_set_volume', '50');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide setVolume()');
    });

    it('reports indeterminate when setVolume throws after dispatch', async () => {
      mockHolder.mod = {
        setVolume: jest.fn().mockRejectedValue(new Error('audio service dead')),
      };

      const result = await executeDeviceAction('device_set_volume', '50');

      expect(result.outcome).toBe('indeterminate');
      expect(result.observation).toContain('UNKNOWN');
      expect(result.observation).toContain('device_set_volume');
      expect(result.observation).toContain('before repeating');
    });

    it('reports failed when setVolume returns structured failure', async () => {
      mockHolder.mod = {
        setVolume: jest.fn().mockResolvedValue({
          success: false,
          error: 'AudioManager unavailable',
        }),
      };

      const result = await executeDeviceAction('device_set_volume', '50');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('AudioManager unavailable');
    });

    it('reports failed when setVolume resolves with no acknowledgement', async () => {
      mockHolder.mod = {
        setVolume: jest.fn().mockResolvedValue(null),
      };

      const result = await executeDeviceAction('device_set_volume', '50');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
    });
  });

  describe('device_open_app (#378)', () => {
    it('dispatches to openApp and never calls performAction', async () => {
      const performAction = jest.fn();
      const openApp = jest.fn().mockResolvedValue({ success: true, message: 'Opened Spotify (com.spotify.music)' });
      mockHolder.mod = { openApp, performAction };

      const result = await executeDeviceAction('device_open_app', 'Spotify');

      expect(openApp).toHaveBeenCalledWith('Spotify');
      expect(performAction).not.toHaveBeenCalled();
      expect(result.outcome).toBe('executed');
      expect(result.observation).toContain('Opened Spotify');
    });

    it('reports failed pre-dispatch when query is empty', async () => {
      const openApp = jest.fn();
      mockHolder.mod = { openApp };

      const result = await executeDeviceAction('device_open_app', '');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('package name or app label is required');
      expect(openApp).not.toHaveBeenCalled();
    });

    it('reports unavailable when the module lacks openApp', async () => {
      mockHolder.mod = { performAction: jest.fn() };

      const result = await executeDeviceAction('device_open_app', 'YouTube');

      expect(result.outcome).toBe('unavailable');
      expect(result.observation).toContain('the module does not provide openApp()');
    });

    it('reports indeterminate when openApp throws after dispatch', async () => {
      mockHolder.mod = {
        openApp: jest.fn().mockRejectedValue(new Error('activity manager crash')),
      };

      const result = await executeDeviceAction('device_open_app', 'YouTube');

      expect(result.outcome).toBe('indeterminate');
      expect(result.observation).toContain('UNKNOWN');
      expect(result.observation).toContain('device_open_app');
      expect(result.observation).toContain('before repeating');
    });

    it('reports failed when openApp returns structured failure (no matching app)', async () => {
      mockHolder.mod = {
        openApp: jest.fn().mockResolvedValue({
          success: false,
          error: 'No launchable app matches "FakeApp"',
        }),
      };

      const result = await executeDeviceAction('device_open_app', 'FakeApp');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('No launchable app matches "FakeApp"');
    });

    it('reports failed when openApp resolves with no acknowledgement', async () => {
      mockHolder.mod = {
        openApp: jest.fn().mockResolvedValue(undefined),
      };

      const result = await executeDeviceAction('device_open_app', 'YouTube');

      expect(result.outcome).toBe('failed');
      expect(result.observation).toContain('returned no acknowledgement');
    });
  });

  describe('device_tap and device_click fallback integrity (#378)', () => {
    it('routes device_tap and device_click to performAction click', async () => {
      const performAction = jest.fn().mockResolvedValue(true);
      mockHolder.mod = { performAction };

      const resTap = await executeDeviceAction('device_tap', 'button_1');
      expect(performAction).toHaveBeenCalledWith('click', 'button_1', '', '');
      expect(resTap.outcome).toBe('executed');

      performAction.mockClear();
      const resClick = await executeDeviceAction('device_click', 'button_2');
      expect(performAction).toHaveBeenCalledWith('click', 'button_2', '', '');
      expect(resClick.outcome).toBe('executed');
    });
  });
});
