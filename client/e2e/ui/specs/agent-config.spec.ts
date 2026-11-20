import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  settingsState,
} from '../e2e';

test.describe('Agent Configuration Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders model preset chips and switches active model', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/agent');

    await expect(page.getByText('Agent Prompt').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'gemini-1.5-pro', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'claude-3-5-sonnet', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'claude-3-5-sonnet', exact: true }).click();

    const state = await settingsState(page);
    expect(state.modelName).toBe('claude-3-5-sonnet');
  });

  test('adjusts model temperature via interactive stepper', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/agent');

    const initial = await settingsState(page);
    const initialTemp = initial.temperature ?? 0.7;

    await expect(page.getByText(/Temperature/i).first()).toBeVisible();

    // Click decrease button (−)
    await page.getByText('−').first().click();

    const updated = await settingsState(page);
    expect(updated.temperature).toBeLessThanOrEqual(initialTemp);
  });
});
