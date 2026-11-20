import { test, expect } from '@playwright/test';
import {
  COMPOSER,
  chatState,
  threadsState,
  seedThreads,
  waitForControlHook,
  resetWorld,
} from '../e2e';

test.describe('Thread Management Flow', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('seeds and retrieves multiple threads with pin states', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedThreads(page, [
      {
        id: 'thread-alpha',
        title: 'Project Roadmap',
        isPinned: true,
        messages: [{ role: 'user', content: 'What is Q4 priority?' }],
      },
      {
        id: 'thread-beta',
        title: 'Weekly Standup',
        isPinned: false,
        messages: [{ role: 'assistant', content: 'Here is the summary.' }],
      },
    ]);

    const state = await threadsState(page);
    expect(state.threads.length).toBeGreaterThanOrEqual(2);

    const alpha = state.threads.find((t: any) => t.id === 'thread-alpha');
    const beta = state.threads.find((t: any) => t.id === 'thread-beta');

    expect(alpha).toBeDefined();
    expect(alpha.title).toBe('Project Roadmap');
    expect(alpha.is_pinned).toBe(true);

    expect(beta).toBeDefined();
    expect(beta.title).toBe('Weekly Standup');
    expect(beta.is_pinned).toBe(false);
  });

  test('switches active thread and updates transcript', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedThreads(page, [
      {
        id: 'thread-one',
        title: 'Topic One',
        messages: [{ role: 'user', content: 'Message in Topic One' }],
      },
      {
        id: 'thread-two',
        title: 'Topic Two',
        messages: [{ role: 'user', content: 'Message in Topic Two' }],
      },
    ]);

    // Switch to Topic Two
    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'thread-two',
        title: 'Topic Two',
        clearFirst: false,
      });
    });

    const active = await chatState(page);
    expect(active.threadId).toBe('thread-two');
    expect(active.messages.some((m) => m.content === 'Message in Topic Two')).toBe(true);
  });

  test('creates a fresh conversation thread', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'thread-fresh',
        title: 'New Exploration',
        messages: [],
        clearFirst: false,
      });
    });

    const active = await chatState(page);
    expect(active.threadId).toBe('thread-fresh');
    expect(active.messages).toEqual([]);

    const composer = page.getByPlaceholder(COMPOSER);
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
  });
});
