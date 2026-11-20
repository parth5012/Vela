/**
 * Native-boundary caveat: This spec asserts web/mock plumbing and UI state for
 * push notification routing, deep links, and registration. Real Android FCM push
 * receipt and system tray interaction require Google Play Services and are verified via ADB.
 */
import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  simulatePushNotification,
  simulateDeviceTokenRegistration,
  seedThreads,
  chatState,
} from '../e2e';

test.describe('FCM Push Notifications & Deep-Link Routing', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('routes incoming push notification payload and selects target thread', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    // Seed multiple threads
    await seedThreads(page, [
      { id: 'fcm-thread-alpha', title: 'Alpha Project Thread' },
      { id: 'fcm-thread-beta', title: 'Beta Deployment Channel' },
    ]);

    // Simulate push notification payload targeting fcm-thread-beta
    await simulatePushNotification(page, {
      type: 'task_completion',
      conversation_id: 'fcm-thread-beta',
    });

    const state = await chatState(page);
    expect(state.threadId).toBe('fcm-thread-beta');
  });

  test('registers device push token with backend control channel', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    const registered = await simulateDeviceTokenRegistration(page, 'e2e-mock-fcm-token-998877');
    expect(registered).toBe(true);
  });
});
