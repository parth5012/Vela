/**
 * Deterministic chat flow over the real Expo web UI (#495).
 *
 * The app is real, the backend is real (FastAPI routes + SQLite persistence),
 * and the only fake is the LLM (`FakeProvider` in `/_e2e` mode). State is
 * asserted through `window.__VELA_E2E__`, never through pixels or sleeps.
 */
import { expect, test } from '@playwright/test';

import {
  SEEDED_BRIEFING_TEXT,
  backendState,
  chatState,
  configState,
  resetBackend,
  scriptBackend,
  transcriptOf,
  waitForControlHook,
  waitForIdle,
} from './e2e';

const COMPOSER = /Ask Vela anything|Ask a question or request a task/;

test.beforeEach(async ({ request }) => {
  await resetBackend(request);
});

test('boots from a deep link with seeded server config (no setup screen)', async ({ page }) => {
  await page.goto('/?e2e_seed=chat');
  await waitForControlHook(page);

  // The control hook has configured server mode, so the setup gate is skipped.
  const config = await configState(page);
  expect(config.connectionMode).toBe('server');
  expect(config.apiUrl).toBe('http://127.0.0.1:8123');
  expect(config.hasApiKey).toBe(true);
  expect(config.isConfigured).toBe(true);

  // Real chat UI is mounted and the seeded thread is active.
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();
  const state = await chatState(page);
  expect(state.threadId).toBeTruthy();
  expect(state.messages).toEqual([]);
  expect(state.streaming).toBe(false);
});

test('sends a turn through the real UI and persists the scripted reply', async ({ page, request }) => {
  await scriptBackend(request, [['Hello ', 'from ', 'the ', 'E2E ', 'backend.']]);
  await page.goto('/?e2e_seed=chat');
  await waitForControlHook(page);

  const composer = page.getByPlaceholder(COMPOSER);
  await expect(composer).toBeVisible();
  await composer.fill('Hi Vela, this is a UI test');
  await page.getByLabel('Send message').first().click();

  // Wait on the store signal, not on a timer: idle AND the scripted reply landed.
  const idle = await waitForIdle(page);
  expect(idle.streaming).toBe(false);
  expect(transcriptOf(idle)).toEqual([
    'user:Hi Vela, this is a UI test',
    'assistant:Hello from the E2E backend.',
  ]);

  // The reply came from the scripted provider, and nothing is left unconsumed.
  const server = await backendState(request);
  expect(server.remaining_turns).toBe(0);
  expect(server.calls).toBeGreaterThan(0);
});

test('briefing screen renders the seeded backend briefing', async ({ page }) => {
  await page.goto('/briefing?e2e_seed=briefing');
  await waitForControlHook(page);

  // Fetched from the real `/api/briefings` route with the seeded row.
  await expect(page.getByText(SEEDED_BRIEFING_TEXT)).toBeVisible({ timeout: 60_000 });
});
