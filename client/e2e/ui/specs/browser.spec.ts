import { test, expect } from '@playwright/test';
import {
  COMPOSER,
  waitForControlHook,
  resetWorld,
  goTo,
  browserState,
} from '../e2e';

test.describe('In-App Browser Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders browser navigation bar, quick links, and empty overlay', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/browser');

    await expect(page.getByPlaceholder('Enter URL...')).toBeVisible();
    await expect(page.getByLabel('Go', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Back', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Forward', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Refresh', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Cookie Sync', { exact: true })).toBeVisible();

    await expect(page.getByText('Enter a URL above or pick a quick link to start browsing.').first()).toBeVisible();
    await expect(page.getByLabel('Open Google')).toBeVisible();
    await expect(page.getByLabel('Open GitHub')).toBeVisible();
  });

  test('navigates via URL bar input and updates browser state', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/browser');

    const urlInput = page.getByPlaceholder('Enter URL...');
    await urlInput.fill('https://news.ycombinator.com');
    await page.getByLabel('Go', { exact: true }).click();

    const state = await browserState(page);
    expect(state.url).toBe('https://news.ycombinator.com');
  });

  test('returns to chat from browser header action', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/browser');
    await expect(page.getByLabel('Return to chat')).toBeVisible();
    await page.getByLabel('Return to chat').click();

    // Verify chat composer is visible again
    await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();
  });
});
