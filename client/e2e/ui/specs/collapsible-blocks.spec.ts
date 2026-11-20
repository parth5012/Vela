import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
} from '../e2e';

test.describe('Collapsible Blocks (Thought, Tool Call, Intent)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders thought block and toggles collapse state', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'thought-thread',
        title: 'Thought Block',
        messages: [
          {
            role: 'assistant',
            content: '<thought>Internal reasoning: calculating algorithmic complexity</thought>Here is the completed response.',
          },
        ],
      });
    });

    const thoughtHeader = page.getByText('Thought Process').first();
    await expect(thoughtHeader).toBeVisible();
    await expect(page.getByText('Here is the completed response.').first()).toBeVisible();

    // Toggle collapse
    await thoughtHeader.click();
    // Header remains visible
    await expect(thoughtHeader).toBeVisible();
  });

  test('renders tool call block with parsed arguments and toggles expansion', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'tool-thread',
        title: 'Tool Call',
        messages: [
          {
            role: 'assistant',
            content: `<call:fetch_weather input='{"city": "Tokyo"}'>Executing query...</call>The weather in Tokyo is clear.`,
          },
        ],
      });
    });

    const toolHeader = page.getByText(/Executed: fetch_weather/i).first();
    await expect(toolHeader).toBeVisible();
    await expect(page.getByText(/"city": "Tokyo"/i).first()).toBeVisible();
    await expect(page.getByText('The weather in Tokyo is clear.').first()).toBeVisible();

    // Toggle collapse
    await toolHeader.click();
    await expect(toolHeader).toBeVisible();
  });

  test('renders intent block with target icon and title', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'intent-thread',
        title: 'Intent Block',
        messages: [
          {
            role: 'assistant',
            content: '<intent>Formulating systematic execution strategy</intent>Strategy established.',
          },
        ],
      });
    });

    const intentHeader = page.getByLabel(/Expand Intent|Collapse Intent/).first();
    await expect(intentHeader).toBeVisible();
    await expect(page.getByText('Strategy established.').first()).toBeVisible();

    // Toggle collapse
    await intentHeader.click();
    await expect(intentHeader).toBeVisible();
  });
});
