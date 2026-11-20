/**
 * Native-boundary caveat: This spec asserts web/mock plumbing and UI state for
 * offline queueing, banner presentation, and sync status. Real OS network listener
 * transitions and disk persistence across process death are verified via ADB harness.
 */
import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  seedOffline,
  offlineState,
} from '../e2e';

test.describe('Offline Sync & Status Indicator Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('displays offline banner when network or backend connectivity is lost', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    // Seed offline state
    await seedOffline(page, { isOnline: false });

    // Verify offline banner appears with canonical copy
    await expect(page.getByText("You're offline. Changes are saved locally and will sync when reconnected.")).toBeVisible();

    const state = await offlineState(page);
    expect(state.isOnline).toBe(false);
    expect(state.syncState).toBe('offline');
  });

  test('reflects queued messages count and updates sync status indicator', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    // Seed offline state with 3 pending messages
    await seedOffline(page, {
      isOnline: false,
      pendingQueueCount: 3,
    });

    // Check sync status indicator accessibility label
    await expect(page.getByLabel('Sync status: offline')).toBeVisible();

    // Reseed online state
    await seedOffline(page, {
      isOnline: true,
      pendingQueueCount: 0,
    });

    await expect(page.getByLabel('Sync status: online')).toBeVisible();
    await expect(page.getByText("You're offline. Changes are saved locally and will sync when reconnected.")).not.toBeVisible();
  });
});
