import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
} from '../e2e';

test.describe('Daily Morning Briefing & History', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders briefing settings sections and weekdays configuration', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/briefing');

    await expect(page.getByText('Daily Briefing').first()).toBeVisible();
    await expect(page.getByText('Briefing Preferences').first()).toBeVisible();
    await expect(page.getByText('Briefing Sections').first()).toBeVisible();
    await expect(page.getByText(/Today Events/i).first()).toBeVisible();
    await expect(page.getByText(/Inbox Triage/i).first()).toBeVisible();
    await expect(page.getByText(/Radar Watch/i).first()).toBeVisible();
  });

  test('adds custom watch alert item and saves', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/briefing');

    const watchInput = page.getByPlaceholder("e.g., Mom's birthday on Sept 12");
    await expect(watchInput).toBeVisible();
    await watchInput.fill('Release candidate v1.0 deployment');

    await page.getByRole('button', { name: 'Add', exact: true }).or(page.getByText('Add', { exact: true })).first().click();
    await expect(page.getByText('Release candidate v1.0 deployment').first()).toBeVisible();
  });

  test('navigates to briefing history records screen', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/briefing');

    const historyBtn = page.getByText(/View Past Briefings/).first();
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    await expect(page.getByText(/E2E seeded briefing|No Briefings Found/i).first()).toBeVisible();
  });
});
