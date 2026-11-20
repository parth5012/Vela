import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
} from '../e2e';

test.describe('Message Options & Actions Modal', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('opens message options on long press and displays action buttons', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'msg-actions-thread',
        title: 'Actions Test',
        messages: [
          {
            id: 'assistant-msg-1',
            role: 'assistant',
            content: 'Here is an actionable assistant message with **markdown**.',
          },
        ],
      });
    });

    const messageBubble = page.getByLabel(/assistant message/i).first();
    await expect(messageBubble).toBeVisible();

    // Trigger long-press via delayed click (600ms exceeds default 500ms long-press threshold)
    await messageBubble.click({ delay: 600 });

    // Verify Message Options modal is opened
    await expect(page.getByText('Message Options').first()).toBeVisible();
    await expect(page.getByLabel('Copy Message').first()).toBeVisible();
    await expect(page.getByLabel('Branch Conversation').first()).toBeVisible();
    await expect(page.getByLabel('Show Raw Markdown').first()).toBeVisible();

    // Dismiss modal via Cancel button
    const cancelButton = page.getByLabel('Cancel').first();
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Modal is dismissed
    await expect(page.getByText('Message Options')).not.toBeVisible();
  });

  test('toggles raw markdown view via message options modal', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'msg-raw-thread',
        title: 'Raw Markdown Test',
        messages: [
          {
            id: 'assistant-raw-1',
            role: 'assistant',
            content: '# Heading 1\n\nSome raw paragraph.',
          },
        ],
      });
    });

    const messageBubble = page.getByLabel(/assistant message/i).first();
    await expect(messageBubble).toBeVisible();

    // Long press to open options
    await messageBubble.click({ delay: 600 });
    await expect(page.getByText('Message Options').first()).toBeVisible();

    // Click Show Raw Markdown
    await page.getByLabel('Show Raw Markdown').first().click();

    // Modal closes
    await expect(page.getByText('Message Options')).not.toBeVisible();
  });
});
