/**
 * Native-boundary caveat: This spec asserts web/mock plumbing and UI state for
 * on-device Local AI configuration. Real on-device GGUF / LiteRT / Needle inference
 * requires Android native libraries (llama.cpp/NEON) and is verified via ADB on device.
 */
import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  settingsState,
} from '../e2e';

test.describe('Local AI & On-Device Engine Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders local AI settings hub, engine selector, and mock fallback indicator', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/local-ai');

    await expect(page.getByText('Local AI').first()).toBeVisible();
    await expect(page.getByText('Engine', { exact: true })).toBeVisible();

    // Verify mock fallback indicator is honest about web/non-native environment
    await expect(page.getByLabel('Needle Engine Mock fallback').first()).toBeVisible();
    await expect(page.getByText(/⚠️ Needle Engine: Mock fallback/i).first()).toBeVisible();
  });

  test('lists on-device models and toggles engine preference', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/settings/local-ai');

    // Verify model specs are listed
    await expect(page.getByText('Needle-3 (20-layer)').first()).toBeVisible();
    await expect(page.getByText('SmolLM 135M').first()).toBeVisible();

    // Toggle engine pill to Local
    const localPill = page.getByRole('button', { name: '📱 Local' }).first();
    await localPill.click();

    const state = await settingsState(page);
    expect(state.connectionMode).toBe('local');
  });
});
