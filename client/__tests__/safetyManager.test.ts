import { classifyAction, evaluateSafety } from '../utils/safetyManager';
import { useConfigStore } from '../store/useConfigStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('Safety Manager Helper', () => {
  beforeEach(() => {
    useConfigStore.getState().clearConfig();
  });

  describe('classifyAction', () => {
    it('should classify high risk actions correctly', () => {
      expect(classifyAction('device_tap', 'click on root button')).toBe('root_shizuku');
      expect(classifyAction('device_tap', 'toggle Accessibility Service')).toBe('permission_toggles');
      expect(classifyAction('device_tap', 'install sideload warning')).toBe('sideloads');
      expect(classifyAction('device_type', 'password_field', 'secret123')).toBe('passwords_otps');
    });

    it('should classify medium risk actions correctly', () => {
      expect(classifyAction('device_open_app', 'Google Play Store')).toBe('play_installs');
      expect(classifyAction('device_open_app', 'Settings')).toBe('settings_changes');
      expect(classifyAction('device_tap', 'delete folder')).toBe('deletions');
      expect(classifyAction('device_tap', 'buy now')).toBe('purchases');
      expect(classifyAction('device_tap', 'send message')).toBe('send_communication');
      expect(classifyAction('device_tap', 'call number')).toBe('calls');
    });

    it('should fallback to base action categories', () => {
      expect(classifyAction('device_screen_read')).toBe('screen_read');
      expect(classifyAction('device_info')).toBe('info');
      expect(classifyAction('device_screenshot')).toBe('screenshot');
      expect(classifyAction('device_scroll')).toBe('scroll');
      expect(classifyAction('device_swipe')).toBe('swipe');
      expect(classifyAction('device_press_key')).toBe('press_key');
      expect(classifyAction('device_set_volume')).toBe('set_volume');
    });
  });

  describe('evaluateSafety', () => {
    it('should allow auto actions immediately', async () => {
      const res = await evaluateSafety('device_screenshot', undefined, undefined, undefined, 'thread_123');
      expect(res.status).toBe('success');
      expect(res.result).toBe('Allowed automatically');
    });

    it('should deny actions immediately if configured as deny', async () => {
      // By default, passwords_otps is 'deny'
      const res = await evaluateSafety('device_type', 'Enter password', '123456');
      expect(res.status).toBe('error');
      expect(res.result).toContain('Blocked by user policy');
    });

    it('should upgrade auto action to confirm when sensitive word is matched', async () => {
      // By default, 'device_tap' is auto. But if target contains 'delete', it should require confirmation.
      // Since useSafetyStore is not fully mocked, let's look at what evaluateSafety does:
      // it tries to call requestApproval.
      const mockRequest = jest.fn().mockImplementation(() => Promise.resolve({ status: 'success', result: 'Approved' }));
      const { useSafetyStore } = require('../store/useSafetyStore');
      useSafetyStore.setState({ requestApproval: mockRequest });

      const res = await evaluateSafety('device_tap', 'delete my account');
      expect(mockRequest).toHaveBeenCalled();
      expect(res.status).toBe('success');
    });
  });
});
