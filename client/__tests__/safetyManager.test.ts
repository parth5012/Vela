import { ensureStandaloneRunner } from './helpers/standaloneRunner';
import { classifyAction, evaluateSafety } from '../utils/safetyManager';
import { useConfigStore } from '../store/useConfigStore';

ensureStandaloneRunner();

describe('Safety Manager Helper', () => {
  beforeEach(() => {
    useConfigStore.getState().clearConfig();
  });

  describe('classifyAction', () => {
    it('should classify high risk actions correctly via device_open_app or typed password value', () => {
      expect(classifyAction('device_open_app', 'click on root button')).toBe('root_shizuku');
      expect(classifyAction('device_open_app', 'toggle Accessibility Service')).toBe('permission_toggles');
      expect(classifyAction('device_open_app', 'install sideload warning')).toBe('sideloads');
      expect(classifyAction('device_type', 'password_field', 'secret_password_123')).toBe('passwords_otps');
    });

    it('should classify medium risk app launches correctly', () => {
      expect(classifyAction('device_open_app', 'Google Play Store')).toBe('play_installs');
      expect(classifyAction('device_open_app', 'Settings')).toBe('settings_changes');
    });

    it('should fallback base action categories directly without fragile target matching', () => {
      expect(classifyAction('device_tap', 'delete folder')).toBe('tap');
      expect(classifyAction('device_type', 'some input')).toBe('type');
      expect(classifyAction('device_swipe')).toBe('swipe');
      expect(classifyAction('device_screen_read')).toBe('screen_read');
      expect(classifyAction('device_info')).toBe('info');
      expect(classifyAction('device_screenshot')).toBe('screenshot');
      expect(classifyAction('device_scroll')).toBe('scroll');
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

    it('should deny actions immediately when configured deny', async () => {
      // default: passwords_otps is 'deny'
      const res = await evaluateSafety('device_type', 'Enter password', 'secret_password_123');
      expect(res.status).toBe('error');
      expect(res.result).toContain('Blocked by Owner policy');
    });

    it('should upgrade auto action to confirm when sensitive word matched in value', async () => {
      const mockRequest = jest.fn().mockImplementation(() =>
        Promise.resolve({ status: 'success', result: 'Approved' })
      );
      const { useSafetyStore } = require('../store/useSafetyStore');
      const originalRequest = useSafetyStore.getState().requestApproval;
      useSafetyStore.setState({ requestApproval: mockRequest });

      try {
        const res = await evaluateSafety('device_scroll', undefined, 'delete my account');
        expect(mockRequest).toHaveBeenCalled();
        expect(res.status).toBe('success');
      } finally {
        useSafetyStore.setState({ requestApproval: originalRequest });
      }
    });

    it('should upgrade auto action to confirm when sensitive word matched in target', async () => {
      const mockRequest = jest.fn().mockImplementation(() =>
        Promise.resolve({ status: 'success', result: 'Approved' })
      );
      const { useSafetyStore } = require('../store/useSafetyStore');
      const originalRequest = useSafetyStore.getState().requestApproval;
      useSafetyStore.setState({ requestApproval: mockRequest });

      try {
        const res = await evaluateSafety('device_scroll', 'delete my account', undefined);
        expect(mockRequest).toHaveBeenCalled();
        expect(res.status).toBe('success');
      } finally {
        useSafetyStore.setState({ requestApproval: originalRequest });
      }
    });

    it('should require confirmation for default-confirm categories (tap/type/swipe) even without sensitive words', async () => {
      // Regression guard for the audit fix: tap/type/swipe now default to
      // 'confirm' in useConfigStore, so they must route through the approval
      // modal instead of executing automatically.
      const mockRequest = jest.fn().mockImplementation(() =>
        Promise.resolve({ status: 'success', result: 'Approved' })
      );
      const { useSafetyStore } = require('../store/useSafetyStore');
      const originalRequest = useSafetyStore.getState().requestApproval;
      useSafetyStore.setState({ requestApproval: mockRequest });

      try {
        for (const toolName of ['device_tap', 'device_type', 'device_swipe']) {
          mockRequest.mockClear();
          const res = await evaluateSafety(toolName, 'harmless target', 'plain value');
          expect(mockRequest).toHaveBeenCalledTimes(1);
          expect(mockRequest.mock.calls[0][0].toolName).toBe(toolName);
          expect(res).toEqual({ status: 'success', result: 'Approved' });
        }
      } finally {
        useSafetyStore.setState({ requestApproval: originalRequest });
      }
    });

    it('should return an error result when the approval modal rejects', async () => {
      const mockRequest = jest.fn().mockImplementation(() =>
        Promise.reject(new Error('modal dismissed'))
      );
      const { useSafetyStore } = require('../store/useSafetyStore');
      const originalRequest = useSafetyStore.getState().requestApproval;
      useSafetyStore.setState({ requestApproval: mockRequest });

      try {
        const res = await evaluateSafety('device_tap', 'ok button');
        expect(res.status).toBe('error');
        expect(res.result).toContain('Safety evaluation failed');
        expect(res.result).toContain('modal dismissed');
      } finally {
        useSafetyStore.setState({ requestApproval: originalRequest });
      }
    });

    it('should block a category flipped to deny at runtime before asking', async () => {
      const previous = useConfigStore.getState().deviceAgentPermissions.tap;
      useConfigStore.getState().setDeviceAgentPermission('tap', 'deny');
      try {
        const res = await evaluateSafety('device_tap', 'ok button');
        expect(res.status).toBe('error');
        expect(res.result).toContain('Tap Screen');
      } finally {
        useConfigStore.getState().setDeviceAgentPermission('tap', previous);
      }
    });
  });

  describe('classifyAction edge cases', () => {
    it('should classify every secret-flavored typed value as passwords_otps', () => {
      expect(classifyAction('device_type', 'field', 'my otp 123456')).toBe('passwords_otps');
      expect(classifyAction('device_type', 'field', 'pin 4321')).toBe('passwords_otps');
      expect(classifyAction('device_type', 'field', 'enter your credentials')).toBe('passwords_otps');
      expect(classifyAction('device_type', 'field', 'verification code: 998877')).toBe('passwords_otps');
    });

    it('should not let non-secret values escalate base UI actions (negative)', () => {
      expect(classifyAction('device_type', 'search box', 'hello world')).toBe('type');
      expect(classifyAction('device_tap', 'delete folder')).toBe('tap');
    });

    it('should fall back to tap for unknown tools (negative)', () => {
      expect(classifyAction('device_unknown_tool', 'whatever')).toBe('tap');
    });

    it('should classify plain app launches as open_app (negative)', () => {
      expect(classifyAction('device_open_app', 'Spotify')).toBe('open_app');
    });
  });
});