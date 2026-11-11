// #556: the onboarding wizard's permissions step is the canonical request
// point for the notifications OS dialog. registerAndPostToken must support a
// "never request" mode so _layout.tsx cannot double-fire the OS dialog.
import * as Notifications from 'expo-notifications';
import { registerAndPostToken } from '../utils/pushRegistration';
import { useConfigStore } from '../store/useConfigStore';

const mocks = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getDevicePushTokenAsync: jest.Mock;
  setNotificationChannelAsync: jest.Mock;
};

describe('pushRegistration (#556 wizard-owned request)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useConfigStore.getState().clearConfig();
    useConfigStore.getState().setConfig('https://api.vela.local', 'test-key');
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    mocks.setNotificationChannelAsync.mockResolvedValue(undefined);
  });

  it('requests permission by default when undetermined (legacy behavior)', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mocks.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    const token = await registerAndPostToken();

    expect(token).toBe('ExponentPushToken[tok]');
    expect(mocks.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never requests permission when requestIfUndetermined is false (#556)', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    const token = await registerAndPostToken({ requestIfUndetermined: false });

    expect(token).toBeNull();
    expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('registers and posts the token when already granted, without requesting', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    const token = await registerAndPostToken({ requestIfUndetermined: false });

    expect(token).toBe('ExponentPushToken[tok]');
    expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.vela.local/api/config/device-token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('still skips the backend POST for standalone modes (no apiUrl)', async () => {
    useConfigStore.getState().clearConfig(); // no server credentials
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    const token = await registerAndPostToken();

    expect(token).toBe('ExponentPushToken[tok]');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
