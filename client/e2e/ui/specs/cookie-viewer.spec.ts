import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  seedBrowser,
} from '../e2e';

test.describe('Cookie Viewer & Sync Modal', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('opens cookie sync modal from browser toolbar and shows import options', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/browser');

    // Click Cookie Sync button in toolbar
    const cookieBtn = page.getByLabel('Cookie Sync', { exact: true });
    await expect(cookieBtn).toBeVisible();
    await cookieBtn.click({ force: true });

    // Verify modal elements
    await expect(page.getByText('Cookie Sync').first()).toBeVisible();
    await expect(page.getByText(/Import cookies.txt \(Netscape\) or Chrome JSON/i).first()).toBeVisible();
    await expect(page.getByText('Pick cookies file').first()).toBeVisible();

    // Close modal
    await page.getByLabel('Close cookie sync').click();
    await expect(page.getByText(/Import cookies.txt/i)).not.toBeVisible();
  });

  test('displays synced badge and timestamp when cookies are seeded', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedBrowser(page, {
      url: 'about:blank',
      lastCookieSync: 1704110400000,
      cookieSyncStatus: 'synced',
      cookieSyncDomains: ['github.com', 'google.com'],
    });

    await goTo(page, '/browser');
    await page.getByLabel('Cookie Sync', { exact: true }).click({ force: true });

    await expect(page.getByText('Synced').first()).toBeVisible();
    await expect(page.getByText(/Last sync:/i).first()).toBeVisible();
  });
});
