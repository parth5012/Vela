/**
 * Dev-only E2E control channel for the Playwright UI suite.
 *
 * This module is the "seam" the UI e2e tests program against, instead of
 * clicking through setup screens or guessing at pixels:
 *
 *   - `configure()`      seed the store with a server connection (no setup UI)
 *   - `seedChat()`       put the app on a known thread with known history
 *   - `getChatState()`   inspect `useChatStore` (messages, streaming, threads)
 *   - `getConfigState()` inspect `useConfigStore` (mode / url / key presence)
 *   - `waitForIdle()`    resolve on a real store signal, never on a fixed sleep
 *   - `goTo()`           deterministic in-app navigation
 *
 * It is only mounted when `EXPO_PUBLIC_E2E === '1'` (see `app/_layout.tsx`),
 * so a normal build never installs `globalThis.__VELA_E2E__` and the
 * `require` branch below folds away in production bundles.
 */
import { router } from 'expo-router';
import { useChatStore, type Message, type Thread } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';

export const E2E_DEFAULT_API_URL = 'http://127.0.0.1:8123';
export const E2E_DEFAULT_API_KEY = 'test-api-key';
export const E2E_THREAD_ID = '00000000-0000-4000-a000-000000000495';
export const E2E_THREAD_TITLE = 'E2E Chat';

export interface E2EConfigInput {
  apiUrl?: string;
  apiKey?: string;
}

export interface E2EChatState {
  threadId: string | null;
  threadCount: number;
  /** `[{role, content}]` of the active thread, in order. */
  messages: Array<Pick<Message, 'role' | 'content'>>;
  streaming: boolean;
}

export interface E2EConfigState {
  connectionMode: string;
  apiUrl: string;
  hasApiKey: boolean;
  isConfigured: boolean;
  hasHydrated: boolean;
}

function queryParams(): URLSearchParams {
  // `window` only exists on web, which is the only target of this suite.
  const location = (globalThis as { location?: { search?: string } }).location;
  return new URLSearchParams(location?.search ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until zustand's persisted state has rehydrated.
 *
 * Bounded so a broken app fails the test instead of hanging it; the loop only
 * observes a store signal (it never advances app state).
 */
async function waitForHydration(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (useConfigStore.getState().hasHydrated) return;
    await sleep(25);
  }
  throw new Error('E2E: useConfigStore never hydrated');
}

/**
 * Point the app at the deterministic backend, bypassing the setup screen.
 *
 * Applied again after hydration because persisted state can land after the
 * first synchronous call.
 */
export async function configure(input: E2EConfigInput = {}): Promise<E2EConfigState> {
  const apiUrl = input.apiUrl || E2E_DEFAULT_API_URL;
  const apiKey = input.apiKey || E2E_DEFAULT_API_KEY;

  const apply = () => {
    useConfigStore.getState().setConnectionMode('server');
    useConfigStore.getState().setConfig(apiUrl, apiKey);
  };

  apply();
  await waitForHydration();
  apply();
  return getConfigState();
}

/**
 * Put the chat screen on a deterministic thread.
 *
 * The backend creates the conversation on the first `/chat/message` call, so a
 * fixed id is enough; seeded history lets a spec assert an exact message list.
 */
export function seedChat(options: {
  threadId?: string;
  title?: string;
  agent?: string;
  messages?: Array<Pick<Message, 'role' | 'content'>>;
  clearFirst?: boolean;
} = {}): E2EChatState {
  const threadId = options.threadId || E2E_THREAD_ID;
  const title = options.title || E2E_THREAD_TITLE;
  const agent = options.agent || 'personal assistant';
  const store = useChatStore.getState();

  if (options.clearFirst) store.clearStore();

  const threads = useChatStore.getState().threads;
  if (!threads.some((thread: Thread) => thread.id === threadId)) {
    useChatStore.getState().createThread(title, threadId, agent);
  }
  useChatStore.getState().selectThread(threadId);

  if (options.messages?.length) {
    useChatStore.getState().setHistory(
      threadId,
      options.messages.map((message, index) => ({
        id: `e2e_seed_${index}`,
        role: message.role,
        content: message.content,
        created_at: '2026-01-01T12:00:00.000Z',
      })),
    );
  }

  return getChatState();
}

export function getChatState(): E2EChatState {
  const state = useChatStore.getState();
  const threadId = state.activeThreadId;
  const threadMessages = threadId ? state.messages[threadId] ?? [] : [];
  return {
    threadId,
    threadCount: state.threads.length,
    messages: threadMessages.map((message) => ({ role: message.role, content: message.content })),
    streaming: state.streamingThreadIds.size > 0,
  };
}

export function getConfigState(): E2EConfigState {
  const state = useConfigStore.getState();
  return {
    connectionMode: state.connectionMode,
    apiUrl: state.apiUrl,
    hasApiKey: Boolean(state.apiKey),
    isConfigured: state.isConfigured,
    hasHydrated: state.hasHydrated,
  };
}

/** Resolve once the UI reports no in-flight stream. */
export async function waitForIdle(timeoutMs = 60_000): Promise<E2EChatState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getChatState();
    if (!state.streaming) return state;
    await sleep(25);
  }
  throw new Error('E2E: stream never went idle');
}

/** Deterministic in-app navigation (expo-router). */
export function goTo(path: string): void {
  router.navigate(path as never);
}

const api = {
  configure,
  seedChat,
  getChatState,
  getConfigState,
  waitForIdle,
  goTo,
  version: 1 as const,
};

export type VelaE2EApi = typeof api;

/**
 * Mount `globalThis.__VELA_E2E__` and apply the deep-link seed.
 *
 * Called from `app/_layout.tsx` only when `EXPO_PUBLIC_E2E === '1'`.
 */
export function installE2ELoader(): VelaE2EApi {
  (globalThis as { __VELA_E2E__?: VelaE2EApi }).__VELA_E2E__ = api;

  const params = queryParams();
  // Seed connection first (synchronously), then the thread, so the first
  // render already sees a configured server-mode app.
  void configure({
    apiUrl: params.get('e2e_api_url') ?? undefined,
    apiKey: params.get('e2e_api_key') ?? undefined,
  })
    .then(() => {
      if (params.get('e2e_seed') === 'chat') {
        seedChat();
      }
    })
    .catch((error) => {
      console.error('[e2e] loader seed failed', error);
    });

  return api;
}
