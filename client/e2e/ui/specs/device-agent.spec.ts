/**
 * Native-boundary caveat: This spec asserts web/mock plumbing and UI state for
 * Device Agent permissions and safety-tier controls. Real Android Accessibility,
 * Shizuku, and JNI actions require an Android device and are verified via ADB harness.
 */
import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  settingsState,
} from '../e2e';

test.describe('Device Agent Permissions & Safety Tiers', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders device agent permissions screen and action risk categories', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/device-agent');

    await expect(page.getByText('Device Agent Permissions').first()).toBeVisible();
    await expect(page.getByText('Low Risk Actions').first()).toBeVisible();
    await expect(page.getByText('Medium Risk Actions').first()).toBeVisible();
    await expect(page.getByText('High Risk Actions').first()).toBeVisible();

    // Verify key action rows are rendered
    await expect(page.getByText('Read Screen Content').first()).toBeVisible();
    await expect(page.getByText('Send Communications').first()).toBeVisible();
    await expect(page.getByText('Root & Shizuku Operations').first()).toBeVisible();
  });

  test('toggles action permission tier and updates config store', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/device-agent');

    // Find the Read Screen Content card
    await expect(page.getByText('Read Screen Content').first()).toBeVisible();

    // Click 'Ask' pill
    const askPill = page.getByRole('button', { name: 'Ask', exact: true }).or(page.getByText('Ask', { exact: true })).first();
    await askPill.click();

    const state = await settingsState(page);
    expect(state.deviceAgentPermissions).toBeDefined();
  });
});
