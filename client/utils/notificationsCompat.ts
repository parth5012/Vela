/**
 * Guarded accessor for `expo-notifications`.
 *
 * Since SDK 53 the package throws *while it is being evaluated* on Android
 * inside Expo Go: `DevicePushTokenAutoRegistration.fx` registers a device push
 * token listener at module scope, and `warnOfExpoGoPushUsage()` throws whenever
 * `isRunningInExpoGo()` is true. Because Metro evaluates the entire static
 * import graph before the first frame, one top-level
 * `import * as Notifications from 'expo-notifications'` takes the whole app
 * down in Expo Go — permissionManager.ts was the first casualty, every route
 * then logged "missing the required default export", and expo-router died with
 * "Cannot read property 'ErrorBoundary' of undefined".
 *
 * Loading the module lazily inside a try/catch keeps development builds and
 * EAS builds fully functional while letting the app boot in Expo Go with
 * notification features disabled. The result is memoized because Metro does
 * not cache a module whose factory threw — without this, every call would
 * retry the failing import and re-throw.
 *
 * Same pattern as the local modules (device-agent, needle, stable-diffusion),
 * which guard `requireNativeModule()` for the same reason.
 */
type NotificationsApi = typeof import('expo-notifications');

let cached: NotificationsApi | null | undefined;

export function notificationsApi(): NotificationsApi | null {
  if (cached === undefined) {
    try {
      cached = require('expo-notifications') as NotificationsApi;
    } catch (err) {
      console.warn(
        '[notificationsCompat] expo-notifications could not be loaded — notifications are disabled',
        err
      );
      cached = null;
    }
  }
  return cached;
}
