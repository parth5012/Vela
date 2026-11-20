import { test, expect } from '@playwright/test';
import {
  COMPOSER,
  waitForControlHook,
  seedThreads,
  resetWorld,
  goTo,
} from '../ui/e2e';

test.describe('Advisory Visual Baselines (360x640)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('setup', async ({ page }) => {
    await page.goto('/?e2e_seed=setup');
    await waitForControlHook(page);
    await expect(page.getByText('Get Started with Vela').first()).toBeVisible();
    await expect(page).toHaveScreenshot('setup.png');
  });

  test('chat-empty', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);
    await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();
    await expect(page).toHaveScreenshot('chat-empty.png');
  });

  test('chat-thread', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedThreads(page, [
      {
        id: 'thread-visual-demo',
        title: 'Status Report',
        messages: [
          { role: 'user', content: 'What is the status of system services?' },
          { role: 'assistant', content: 'All services are running normally with optimal response latency.' },
        ],
      },
    ]);

    await expect(page.getByText('All services are running normally').first()).toBeVisible();
    await expect(page).toHaveScreenshot('chat-thread.png');
  });

  test('settings-appearance', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);
    await goTo(page, '/settings/appearance');
    await expect(page.getByText('Color Scheme').first()).toBeVisible();
    await expect(page).toHaveScreenshot('settings-appearance.png');
  });

  test('tasks-empty', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);
    await goTo(page, '/tasks');
    await expect(page.getByText('Task Scheduler').first()).toBeVisible();
    await expect(page).toHaveScreenshot('tasks-empty.png');
  });
});
