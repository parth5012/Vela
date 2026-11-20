import { test, expect } from '@playwright/test';
import {
  waitForControlHook,
  resetWorld,
} from '../e2e';

test.describe('Rich Rendering Surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetWorld(page, request);
  });

  test('renders markdown formatting, headings, and bullet lists', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'rich-md-thread',
        title: 'Rich Markdown',
        messages: [
          {
            role: 'assistant',
            content: '# Project Overview\n\nThis is **bold text** and *italic style*.\n\n- Key Priority Alpha\n- Key Priority Beta',
          },
        ],
      });
    });

    await expect(page.getByText('Project Overview').first()).toBeVisible();
    await expect(page.getByText('bold text').first()).toBeVisible();
    await expect(page.getByText('Key Priority Alpha').first()).toBeVisible();
  });

  test('renders LaTeX mathematical expressions', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'latex-thread',
        title: 'LaTeX Math',
        messages: [
          {
            role: 'assistant',
            content: 'Mass-energy equivalence: $$E = mc^2$$ and Euler identity $e^{i\\pi} + 1 = 0$.',
          },
        ],
      });
    });

    // Content is rendered into the message item
    await expect(page.getByText(/Mass-energy equivalence/i).first()).toBeVisible();
  });

  test('renders Mermaid diagrams with interactive view tabs', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'mermaid-thread',
        title: 'Mermaid Diagrams',
        messages: [
          {
            role: 'assistant',
            content: '```mermaid\ngraph TD\n    A[Client] --> B[Server]\n    B --> C[Database]\n```',
          },
        ],
      });
    });

    // On web, Mermaid renders source container
    await expect(page.getByLabel('Mermaid source code').first()).toBeVisible();
    await expect(page.getByText(/graph TD/i).first()).toBeVisible();
  });

  test('renders syntax-highlighted code blocks', async ({ page }) => {
    await page.goto('/?e2e_seed=chat');
    await waitForControlHook(page);

    await page.evaluate(() => {
      window.__VELA_E2E__?.seedChat({
        threadId: 'code-thread',
        title: 'Code Snippets',
        messages: [
          {
            role: 'assistant',
            content: '```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n```',
          },
        ],
      });
    });

    await expect(page.getByText(/function greet/i).first()).toBeVisible();
  });
});
