import { test, expect } from '@playwright/test';
import {
  BACKEND_URL,
  BACKEND_API_KEY,
  COMPOSER,
  configState,
  waitForControlHook,
  resetWorld,
} from '../e2e';

test.describe('Server Setup Flow', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('redirects unconfigured client to setup wizard', async ({ page }) => {
    await page.goto('/?e2e_unconfigured=1');
    await waitForControlHook(page);

    await expect(page.getByText('VELA').first()).toBeVisible();
    await expect(page.getByText('Connect to Server')).toBeVisible();

    const config = await configState(page);
    expect(config.isConfigured).toBe(false);
  });

  test('validates required fields on server setup', async ({ page }) => {
    await page.goto('/?e2e_unconfigured=1');
    await waitForControlHook(page);

    await page.getByText('Connect to Server').click();
    await expect(page.getByPlaceholder('https://api.vela.local')).toBeVisible();

    await page.getByText('Connect & Save').click();
    await expect(page.getByText('API URL is required')).toBeVisible();
  });

  test('connects successfully to backend server', async ({ page }) => {
    await page.goto('/?e2e_unconfigured=1');
    await waitForControlHook(page);

    await page.getByText('Connect to Server').click();
    const urlInput = page.getByPlaceholder('https://api.vela.local');
    const keyInput = page.getByPlaceholder('Enter your API access token');

    await urlInput.fill(BACKEND_URL);
    await keyInput.fill(BACKEND_API_KEY);
    await page.getByText('Connect & Save').click();

    await expect(page.getByText(/Credentials verified|Connected/i).first()).toBeVisible();
  });

  test('seeded-config deep link bypasses setup wizard to main chat', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    const composer = page.getByPlaceholder(COMPOSER);
    await expect(composer).toBeVisible();

    const config = await configState(page);
    expect(config.isConfigured).toBe(true);
    expect(config.hasApiKey).toBe(true);
  });
});
