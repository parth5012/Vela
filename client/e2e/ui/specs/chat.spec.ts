import { test, expect } from '@playwright/test';
import {
  COMPOSER,
  scriptBackend,
  backendState,
  chatState,
  waitForControlHook,
  waitForIdle,
  transcriptOf,
  resetWorld,
} from '../e2e';

test.describe('Chat Streaming & Control Flow', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('happy turn streams tokens and persists transcript', async ({ page, request }) => {
    await scriptBackend(request, [['Hello ', 'from ', 'Vela ', 'AI.']]);
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    const composer = page.getByPlaceholder(COMPOSER);
    await expect(composer).toBeVisible();
    await composer.fill('Say hello');
    await page.getByLabel('Send message').first().click();

    const idle = await waitForIdle(page);
    expect(idle.streaming).toBe(false);
    expect(transcriptOf(idle)).toEqual([
      'user:Say hello',
      'assistant:Hello from Vela AI.',
    ]);

    const server = await backendState(request);
    expect(server.remaining_turns).toBe(0);
    expect(server.calls).toBeGreaterThan(0);
  });

  test('handles backend SSE error turn cleanly without crashing', async ({ page, request }) => {
    await scriptBackend(request, [
      { kind: 'error', message: 'Deterministic rate limit exceeded', ms: 50 },
    ]);
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    const composer = page.getByPlaceholder(COMPOSER);
    await expect(composer).toBeVisible();
    await composer.fill('Trigger error turn');
    await page.getByLabel('Send message').first().click();

    const idle = await waitForIdle(page);
    expect(idle.streaming).toBe(false);

    // Turn was processed by server and app remains responsive
    const server = await backendState(request);
    expect(server.remaining_turns).toBe(0);
    await expect(composer).toBeEnabled();
  });

  test('slow delay stream handles chunks and resolves to idle', async ({ page, request }) => {
    await scriptBackend(request, [
      { kind: 'delay', ms: 100, chunks: ['Delayed ', 'response ', 'complete.'] },
    ]);
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    const composer = page.getByPlaceholder(COMPOSER);
    await expect(composer).toBeVisible();
    await composer.fill('Delay test');
    await page.getByLabel('Send message').first().click();

    const idle = await waitForIdle(page);
    expect(idle.streaming).toBe(false);
    expect(transcriptOf(idle)).toEqual([
      'user:Delay test',
      'assistant:Delayed response complete.',
    ]);

    const server = await backendState(request);
    expect(server.remaining_turns).toBe(0);
  });
});
