import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  seedSafety,
  resetWorld,
} from '../e2e';

test.describe('Safety Tier Badges & Safety Dialog', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('displays safety authorization dialog and resolves on Allow Once', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await seedSafety(page, {
      toolName: 'delete_file',
      target: 'sensitive_data.txt',
      value: 'force=true',
      thoughts: 'Cleaning up obsolete temporary files.',
    });

    // Verify Safety Authorization modal presentation
    await expect(page.getByText('🛡️ Safety Authorization').first()).toBeVisible();
    await expect(page.getByText('delete_file').first()).toBeVisible();
    await expect(page.getByText('sensitive_data.txt').first()).toBeVisible();

    // Verify all four action buttons
    await expect(page.getByText('Always Allow').first()).toBeVisible();
    await expect(page.getByText('Allow Once').first()).toBeVisible();
    await expect(page.getByText('Always Block').first()).toBeVisible();
    await expect(page.getByText('Deny Once').first()).toBeVisible();

    // Click Allow Once and verify modal dismisses
    await page.getByText('Allow Once').first().click();
    await expect(page.getByText('🛡️ Safety Authorization')).not.toBeVisible();
  });

  test('renders safety tier pills (Auto, Ask, Blocked) on tool calls', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'safety-tiers-thread',
        title: 'Safety Tiers',
        messages: [
          {
            role: 'assistant',
            content: [
              '<call:device_screenshot input=\'{"target": "screen capture"}\'>Capture done</call>',
              '<call:device_tap input=\'{"target": "delete folder"}\'>Tap done</call>',
              '<call:device_type input=\'{"target": "password_field", "value": "password123"}\'>Type done</call>',
            ].join('\n'),
          },
        ],
      });
    });

    // Auto tier pill
    await expect(page.getByText('Auto').first()).toBeVisible();
    // Ask tier pill
    await expect(page.getByText('Ask').first()).toBeVisible();
    // Blocked tier pill
    await expect(page.getByText('Blocked').first()).toBeVisible();
  });
});
