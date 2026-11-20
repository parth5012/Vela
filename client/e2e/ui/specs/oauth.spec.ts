import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  seedOAuth,
  oauthState,
} from '../e2e';

test.describe('Google OAuth & Workspace Integration', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('displays disconnected Google Workspace card with sign-in trigger', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/connection');

    await expect(page.getByText('Google Workspace', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sign in with Google to give your Vela agent access')).toBeVisible();
    await expect(page.getByText('Sign in with Google').first()).toBeVisible();

    const state = await oauthState(page);
    expect(state.isConnected).toBe(false);
  });

  test('renders connected user info, email, and disconnects cleanly', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedOAuth(page, {
      isConnected: true,
      email: 'alex.developer@gmail.com',
      name: 'Alex Developer',
    });

    await goTo(page, '/settings/connection');

    await expect(page.getByText('Alex Developer').first()).toBeVisible();
    await expect(page.getByText('alex.developer@gmail.com').first()).toBeVisible();
    await expect(page.getByText('Disconnect Google Account').first()).toBeVisible();

    // Click disconnect
    await page.getByText('Disconnect Google Account').first().click();

    await expect(page.getByText('Sign in with Google').first()).toBeVisible();
    const state = await oauthState(page);
    expect(state.isConnected).toBe(false);
  });
});
