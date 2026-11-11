// #556: the onboarding wizard's permissions step is the canonical request
// point for the notifications OS dialog. registerAndPostToken must support a
// "never request" mode so _layout.tsx cannot double-fire the OS dialog.
import * as Notifications from 'expo-notifications';
import {
  registerAndPostToken,
  __resetPushRegistrationForTests,
} from '../utils/pushRegistration';
import { useConfigStore } from '../store/useConfigStore';

const mocks = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getDevicePushTokenAsync: jest.Mock;
  setNotificationChannelAsync: jest.Mock;
  addPushTokenListener: jest.Mock;
};

describe('pushRegistration (#556 wizard-owned request)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPushRegistrationForTests();
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

  // #556 self-review (C1/C2): the wizard and the _layout effect can both fire
  // registration when isConfigured flips — concurrent calls must share one
  // in-flight registration and a completed one must not repeat.
  it('shares one in-flight registration across concurrent callers (single POST)', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    const [a, b] = await Promise.all([registerAndPostToken(), registerAndPostToken()]);

    expect(a).toBe('ExponentPushToken[tok]');
    expect(b).toBe('ExponentPushToken[tok]');
    const postCalls = (globalThis.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === 'https://api.vela.local/api/config/device-token'
    );
    expect(postCalls).toHaveLength(1);
  });

  it('does not re-register after a successful registration this session', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    const first = await registerAndPostToken();
    const second = await registerAndPostToken({ requestIfUndetermined: false });

    expect(first).toBe('ExponentPushToken[tok]');
    expect(second).toBeNull();
    const postCalls = (globalThis.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === 'https://api.vela.local/api/config/device-token'
    );
    expect(postCalls).toHaveLength(1);
    expect(mocks.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
  });

  // #556 final self-review: a short-circuit (already-registered this session)
  // must not leave the session without token-refresh handling — the listener
  // is attached exactly once per session, including on the success path.
  it('attaches the token refresh listener exactly once per session, even when short-circuiting', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getDevicePushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });

    await registerAndPostToken(); // success path
    await registerAndPostToken(); // short-circuits on registeredThisSession
    await registerAndPostToken(); // still short-circuits

    expect(mocks.addPushTokenListener).toHaveBeenCalledTimes(1);
  });
});
