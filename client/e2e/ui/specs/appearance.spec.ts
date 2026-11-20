import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  settingsState,
} from '../e2e';

test.describe('Appearance & Themes Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders all six tonal color schemes and three font scales', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/appearance');

    await expect(page.getByText('Color Scheme').first()).toBeVisible();
    await expect(page.getByText('Berry').first()).toBeVisible();
    await expect(page.getByText('Citrus').first()).toBeVisible();
    await expect(page.getByText('Noir').first()).toBeVisible();

    await expect(page.getByText('Font Scale').first()).toBeVisible();
    await expect(page.getByText('Compact').first()).toBeVisible();
    await expect(page.getByText('Regular').first()).toBeVisible();
    await expect(page.getByText('Large').first()).toBeVisible();
  });

  test('updates theme selection and persists into config state', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/appearance');

    await page.getByText('Citrus').first().click();
    let state = await settingsState(page);
    expect(state.theme).toBe('citrus');

    await page.getByText('Noir').first().click();
    state = await settingsState(page);
    expect(state.theme).toBe('noir');
  });

  test('updates font scale selection and persists into config state', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/appearance');

    await page.getByText('Large').first().click();
    let state = await settingsState(page);
    expect(state.fontSize).toBe('large');

    await page.getByText('Compact').first().click();
    state = await settingsState(page);
    expect(state.fontSize).toBe('small');
  });
});
