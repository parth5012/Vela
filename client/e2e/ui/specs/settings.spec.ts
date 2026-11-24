import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
} from '../e2e';

test.describe('Settings Hub & Sub-screen Navigation', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders settings hub categories and options', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings');

    await expect(page.getByText('Settings').first()).toBeVisible();
    await expect(page.getByText('CONNECTION & ACCOUNTS').first()).toBeVisible();
    await expect(page.getByText('APPEARANCE').first()).toBeVisible();
    await expect(page.getByText('AGENT', { exact: true })).toBeVisible();
  });

  test('navigates to connection settings and verifies fields', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings');
    await page.getByText('Server & API Key').first().click();

    await expect(page.getByText('Connection & Mode').first()).toBeVisible();
    await expect(page.getByText('Server URL').first()).toBeVisible();
  });

  test('navigates to appearance settings from hub', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings');
    await page.getByText('Theme').first().click();

    await expect(page.getByText('Color Scheme').first()).toBeVisible();
    await expect(page.getByText('Font Scale').first()).toBeVisible();
  });

  test('navigates to notification settings from hub and displays quiet hours and channels', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings');
    await page.getByText('Notifications').first().click();

    await expect(page.getByText('Quiet Hours').first()).toBeVisible();
    await expect(page.getByText('Enable Quiet Hours').first()).toBeVisible();
    await expect(page.getByText('Notification Channels').first()).toBeVisible();
  });
});
