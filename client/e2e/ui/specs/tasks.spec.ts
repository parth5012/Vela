import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  seedTasks,
  tasksState,
  goTo,
} from '../e2e';

test.describe('Tasks & Scheduler Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('lists seeded scheduled tasks from SQLite storage', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedTasks(page);
    await goTo(page, '/tasks');

    await expect(page.getByText('Task Scheduler').first()).toBeVisible();
    await expect(page.getByText('Daily Briefing Automation').first()).toBeVisible();
    await expect(page.getByText('Weekly Summary Sync').first()).toBeVisible();

    const state = await tasksState(page);
    expect(state.count).toBeGreaterThanOrEqual(3);
  });

  test('filters tasks by active, paused, and all statuses', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedTasks(page);
    await goTo(page, '/tasks');

    // Click PAUSED filter
    await page.getByLabel('paused tasks').click();
    await expect(page.getByText('Weekly Summary Sync').first()).toBeVisible();
    await expect(page.getByText('Daily Briefing Automation')).not.toBeVisible();

    // Click ACTIVE filter
    await page.getByLabel('active tasks').click();
    await expect(page.getByText('Daily Briefing Automation').first()).toBeVisible();
    await expect(page.getByText('Weekly Summary Sync')).not.toBeVisible();

    // Click ALL filter
    await page.getByLabel('all tasks').click();
    await expect(page.getByText('Daily Briefing Automation').first()).toBeVisible();
    await expect(page.getByText('Weekly Summary Sync').first()).toBeVisible();
  });

  test('creates a new scheduled task and persists into SQLite', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedTasks(page);
    const initial = await tasksState(page);
    const initialCount = initial.count;

    await goTo(page, '/tasks');
    await page.getByText('+ Add Task').click();

    await expect(page.getByText('New Scheduled Task').first()).toBeVisible();
    const nameInput = page.getByPlaceholder('Give your scheduled task a name');
    await nameInput.fill('Playwright Test Task');

    const descInput = page.getByPlaceholder('What does this task do?');
    await descInput.fill('Automated validation task description');

    const promptInput = page.getByPlaceholder('Provide instructions to key agent. Runs in background.');
    await promptInput.fill('Validate system health and notifications.');

    await page.getByText('Save Task').click();
    await expect(page.getByText('Playwright Test Task').first()).toBeVisible();

    const updated = await tasksState(page);
    expect(updated.count).toBe(initialCount + 1);
  });
});
