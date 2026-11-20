import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
  goTo,
  seedExecution,
} from '../e2e';

test.describe('Task Progress Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('displays empty state when no foreground task is executing', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await goTo(page, '/task-progress');

    await expect(page.getByText('No active task').first()).toBeVisible();
    await expect(page.getByText(/There is no task currently running/i).first()).toBeVisible();
    await expect(page.getByText('Go to Tasks').first()).toBeVisible();
  });

  test('renders active execution states and task details from SQLite', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedExecution(page, {
      id: 'task-progress-demo',
      title: 'Data Migration Workflow',
      status: 'active',
      recurrence_rule: '0 9 * * *',
      linked_agent: 'analyst',
      task_prompt: 'Run migration steps.',
    }, {
      id: 'exec-demo-001',
      status: 'running',
      current_step_index: 0,
    });

    await goTo(page, '/task-progress?taskId=task-progress-demo');

    await expect(page.getByText('Data Migration Workflow').first()).toBeVisible();
    await expect(page.getByText('Running').first()).toBeVisible();
    await expect(page.getByLabel('Cancel task').first()).toBeVisible();
  });
});
