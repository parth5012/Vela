/**
 * Regression: a single top-level `import * as Notifications from
 * 'expo-notifications'` anywhere in the app crashes the bundle inside Expo Go.
 *
 * Since SDK 53 the module throws while it is being evaluated on Android in
 * Expo Go (DevicePushTokenAutoRegistration.fx calls addPushTokenListener(),
 * which routes to warnOfExpoGoPushUsage() and throws). Metro evaluates the
 * whole static import graph at startup, so the throw aborts the importing
 * module: the Metro log for PR #406 showed permissionManager.ts:2 dying first,
 * then every route logging "missing the required default export" and finally
 * expo-router crashing with "Cannot read property 'ErrorBoundary' of undefined".
 *
 * These tests pin the guarded-loader contract: loading the module must be lazy,
 * must be attempted at most once, and must degrade to null instead of throwing.
 */

jest.mock('expo-notifications', () => {
  // Mirror warnOfExpoGoPushUsage.js: throw when evaluated inside Expo Go.
  const g = globalThis as unknown as { __expoNotifLoadAttempts?: number };
  g.__expoNotifLoadAttempts = (g.__expoNotifLoadAttempts ?? 0) + 1;
  throw new Error(
    'expo-notifications: Android Push notifications (remote notifications) functionality ' +
      'provided by expo-notifications was removed from Expo Go with the release of SDK 53.'
  );
});

import { notificationsApi } from '../utils/notificationsCompat';
import { checkPermission, requestPermission } from '../utils/permissionManager';

const loadAttempts = () =>
  (globalThis as unknown as { __expoNotifLoadAttempts?: number }).__expoNotifLoadAttempts ?? 0;

describe('expo-notifications failing to load (Expo Go on Android)', () => {
  it('does not crash the module graph and degrades permission checks', async () => {
    // Importing permissionManager already succeeded — the static import that
    // used to live in permissionManager.ts would have thrown here.
    expect(typeof checkPermission).toBe('function');
    expect(typeof requestPermission).toBe('function');

    await expect(checkPermission('notifications')).resolves.toBe('undetermined');
    await expect(requestPermission('notifications')).resolves.toBe('undetermined');
    await expect(checkPermission('storage')).resolves.toBe('granted');

    // The failed module must be attempted exactly once, not on every call —
    // Metro does not cache a module whose factory threw.
    expect(loadAttempts()).toBe(1);
  });

  it('exposes a null api to callers instead of throwing', () => {
    expect(notificationsApi()).toBeNull();
    expect(loadAttempts()).toBe(1);
  });
});
