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
});
