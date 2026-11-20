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
export const COMPOSER = /Ask Vela anything|Ask a question or request a task/;

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
  theme?: string;
  accentColor?: string;
  fontSize?: string;
  temperature?: number;
  systemPrompt?: string;
  modelName?: string;
  userName?: string;
  deviceAgentPermissions?: any;
}

export interface VelaE2EApi {
  configure(input?: { apiUrl?: string; apiKey?: string }): Promise<ConfigState>;
  seedChat(options?: {
    threadId?: string;
    title?: string;
    agent?: string;
    messages?: Array<{ id?: string; role: 'user' | 'assistant'; content: string }>;
    clearFirst?: boolean;
  }): ChatState;
  getChatState(): ChatState;
  getConfigState(): ConfigState;
  waitForIdle(timeoutMs?: number): Promise<ChatState>;
  goTo(path: string): void;
  seedTasks(tasksList?: any[], clearFirst?: boolean): Promise<any>;
  getTasksState(): Promise<any>;
  seedExecution(task?: any, execution?: any): Promise<void>;
  seedSettings(settings: any): ConfigState;
  seedThreads(threadsList: any[], clearFirst?: boolean): any;
  getThreadsState(): any;
  seedOAuth(oauth?: any): any;
  getOAuthState(): any;
  seedBriefing(): Promise<any>;
  seedBrowser(browser?: any): any;
  getBrowserState(): any;
  seedOffline(offline?: any): any;
  getOfflineState(): any;
  seedSafety(safety?: any): any;
  getSafetyState(): any;
  simulatePushNotification(data: Record<string, string>): Promise<void>;
  simulateDeviceTokenRegistration(token: string): Promise<boolean>;
  loadFixture(name: string): Promise<any>;
  resetWorld(): Promise<void>;
  version: 2;
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
): Promise<{ remaining_turns: number; calls: number; threads: Array<{ id: string; title: string }>; available_fixtures?: string[] }> {
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

/**
 * Universal reset across backend, Zustand stores, and SQLite DB.
 * Can be called in test.beforeEach().
 */
export async function resetWorld(page?: Page, request?: APIRequestContext): Promise<void> {
  if (request) {
    await resetBackend(request);
  }
  if (page) {
    await page.evaluate(async () => {
      const api = window.__VELA_E2E__;
      if (api && typeof api.resetWorld === 'function') {
        await api.resetWorld();
      }
    });
  }
}

/**
 * Load a named fixture both server-side (if request available) and client-side.
 */
export async function loadFixture(
  page: Page,
  name: string,
  request?: APIRequestContext,
): Promise<any> {
  const req = request ?? page.request;
  try {
    const res = await req.post(`${BACKEND_URL}/_e2e/fixture`, { data: { name } });
    if (!res.ok()) {
      // Backend might return 400 for client-only fixtures (e.g. "browser", "tasks"), which is fine
    }
  } catch (err) {
    // Non-fatal if backend call fails for a purely client-side scenario
  }

  return page.evaluate(async (fixtureName) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.loadFixture(fixtureName);
  }, name);
}

// --- Domain Helpers ---

export async function goTo(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.__VELA_E2E__?.goTo(p);
  }, path);
}

export async function tasksState(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getTasksState();
  });
}

export async function seedTasks(page: Page, tasksList?: any[], clearFirst?: boolean): Promise<any> {
  return page.evaluate(async ({ list, clear }) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedTasks(list, clear);
  }, { list: tasksList, clear: clearFirst });
}

export async function seedExecution(page: Page, task?: any, execution?: any): Promise<void> {
  return page.evaluate(async ({ t, e }) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedExecution(t, e);
  }, { t: task, e: execution });
}

export async function settingsState(page: Page): Promise<ConfigState> {
  return configState(page);
}

export async function seedSettings(page: Page, settings: any): Promise<ConfigState> {
  return page.evaluate((s) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedSettings(s);
  }, settings);
}

export async function threadsState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getThreadsState();
  });
}

export async function seedThreads(page: Page, threadsList: any[], clearFirst?: boolean): Promise<any> {
  return page.evaluate(({ list, clear }) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedThreads(list, clear);
  }, { list: threadsList, clear: clearFirst });
}

export async function oauthState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getOAuthState();
  });
}

export async function seedOAuth(page: Page, oauth?: any): Promise<any> {
  return page.evaluate((o) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedOAuth(o);
  }, oauth);
}

export async function browserState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getBrowserState();
  });
}

export async function seedBrowser(page: Page, browser?: any): Promise<any> {
  return page.evaluate((b) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedBrowser(b);
  }, browser);
}

export async function offlineState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getOfflineState();
  });
}

export async function seedOffline(page: Page, offline?: any): Promise<any> {
  return page.evaluate((o) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedOffline(o);
  }, offline);
}

export async function safetyState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.getSafetyState();
  });
}

export async function seedSafety(page: Page, safety?: any): Promise<any> {
  return page.evaluate((s) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.seedSafety(s);
  }, safety);
}

export async function simulatePushNotification(page: Page, data: Record<string, string>): Promise<void> {
  return page.evaluate((d) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.simulatePushNotification(d);
  }, data);
}

export async function simulateDeviceTokenRegistration(page: Page, token: string): Promise<boolean> {
  return page.evaluate((t) => {
    const api = window.__VELA_E2E__;
    if (!api) throw new Error('__VELA_E2E__ missing');
    return api.simulateDeviceTokenRegistration(t);
  }, token);
}
