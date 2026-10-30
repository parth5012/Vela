/**
 * Shared helpers for the deterministic UI e2e specs (#495).
 *
 * Two surfaces are used, and nothing else:
 *   1. the backend `/_e2e/*` control channel (scripted LLM turns + real
 *      server state), and
 *   2. `window.__VELA_E2E__`, the client-side store inspection hook.
 *
 * No fetch mocking, no screenshot comparison, no arbitrary sleeps.
 */
import type { APIRequestContext, Page } from '@playwright/test';

export const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:8123';
export const BACKEND_API_KEY = 'test-api-key';
export const SEEDED_THREAD_ID = '00000000-0000-4000-8000-000000000001';
export const SEEDED_BRIEFING_TEXT = 'E2E seeded briefing: inbox clear, 2 meetings, radar calm.';

export interface ChatState {
  threadId: string | null;
  threadCount: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  streaming: boolean;
}

export interface ConfigState {
  connectionMode: string;
  apiUrl: string;
  hasApiKey: boolean;
  isConfigured: boolean;
  hasHydrated: boolean;
}

export interface VelaE2EApi {
  configure(input?: { apiUrl?: string; apiKey?: string }): Promise<ConfigState>;
  seedChat(options?: {
    threadId?: string;
    title?: string;
    agent?: string;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    clearFirst?: boolean;
  }): ChatState;
  getChatState(): ChatState;
  getConfigState(): ConfigState;
  waitForIdle(timeoutMs?: number): Promise<ChatState>;
  goTo(path: string): void;
  version: 1;
}

declare global {
  interface Window {
    __VELA_E2E__?: VelaE2EApi;
  }
}

/** Reset the backend DB to its seeded state and clear the scripted LLM turns. */
export async function resetBackend(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${BACKEND_URL}/_e2e/reset`);
  if (!response.ok()) {
    throw new Error(`/_e2e/reset failed: ${response.status()} ${await response.text()}`);
  }
}

/** Program the FakeProvider with the turns this test expects the app to consume. */
export async function scriptBackend(
  request: APIRequestContext,
  turns: unknown[],
): Promise<void> {
  const response = await request.post(`${BACKEND_URL}/_e2e/script`, { data: { turns } });
  if (!response.ok()) {
    throw new Error(`/_e2e/script failed: ${response.status()} ${await response.text()}`);
  }
}

/** Real server-side signal: how much of the script is still unconsumed. */
export async function backendState(
  request: APIRequestContext,
): Promise<{ remaining_turns: number; calls: number; threads: Array<{ id: string; title: string }> }> {
  const response = await request.get(`${BACKEND_URL}/_e2e/state`);
  if (!response.ok()) {
    throw new Error(`/_e2e/state failed: ${response.status()}`);
  }
  return response.json();
}

/** Fail fast with a useful message when the control hook is not installed. */
export async function waitForControlHook(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__VELA_E2E__), undefined, { timeout: 120_000 });
}

export async function chatState(page: Page): Promise<ChatState> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getChatState();
  });
}

export async function configState(page: Page): Promise<ConfigState> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getConfigState();
  });
}

export async function waitForIdle(page: Page, timeoutMs = 60_000): Promise<ChatState> {
  return page.evaluate(
    (timeout) => {
      const api = window.__VELA_E2E__;
      if (!api) throw new Error('__VELA_E2E__ missing');
      return api.waitForIdle(timeout);
    },
    timeoutMs,
  );
}

/** `role:content` for each active-thread message — compact exact comparison. */
export function transcriptOf(state: ChatState): string[] {
  return state.messages.map((message) => `${message.role}:${message.content}`);
}
