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
 *   - `seedTasks()`      seed tasks in the SQLite store
 *   - `getTasksState()`  inspect tasks in SQLite
 *   - `seedSettings()`   configure appearance / model / persona
 *   - `seedThreads()`    seed multi-thread scenarios
 *   - `seedOAuth()`      seed connected Google OAuth user & tokens
 *   - `seedBrowser()`    seed in-app browser state
 *   - `seedOffline()`    seed offline / online connectivity state
 *   - `seedSafety()`     seed tool approval safety cards
 *   - `loadFixture()`    load named scenario (chat, tasks, oauth, etc.)
 *   - `resetWorld()`     single-call reset of backend, stores, and SQLite DB
 *
 * It is only mounted when `EXPO_PUBLIC_E2E === '1'` (see `app/_layout.tsx`),
 * so a normal build never installs `globalThis.__VELA_E2E__` and the
 * `require` branch below folds away in production bundles.
 */
import { router } from 'expo-router';
import { useChatStore, type Message, type Thread } from '../store/useChatStore';
import { useConfigStore, type ConnectionMode } from '../store/useConfigStore';
import { useGoogleAuthStore, type GoogleWorkspaceScope } from '../store/useGoogleAuthStore';
import { useBrowserStore } from '../store/useBrowserStore';
import { useOfflineStore } from '../store/useOfflineStore';
import { useSafetyStore } from '../store/useSafetyStore';
import { db, initializeDatabase, resetE2EDatabase } from '../db/client';
import { tasks, taskExecutions, type TaskEntity } from '../db/schema';
import type { ThemeName } from '../utils/theme';
import { parseNotificationData } from '../utils/notificationRouting';

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
  theme?: string;
  accentColor?: string;
  fontSize?: string;
  temperature?: number;
  systemPrompt?: string;
  modelName?: string;
  userName?: string;
  deviceAgentPermissions?: any;
}

export interface E2EThreadInput {
  id: string;
  title: string;
  agent?: string;
  isPinned?: boolean;
  messages?: Array<Pick<Message, 'role' | 'content'>>;
}

export interface E2EThreadsState {
  activeThreadId: string | null;
  threads: Array<{
    id: string;
    title: string;
    agent: string;
    is_pinned: boolean;
    messageCount: number;
  }>;
}

export interface E2ETasksState {
  tasks: TaskEntity[];
  count: number;
}

export interface E2EOAuthInput {
  isConnected?: boolean;
  email?: string;
  name?: string;
  scopes?: GoogleWorkspaceScope[];
}

export interface E2EOAuthState {
  isConnected: boolean;
  email: string | null;
  scopes: GoogleWorkspaceScope[];
}

export interface E2EBrowserInput {
  url?: string;
  title?: string;
  isVisible?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  cookieSyncStatus?: 'idle' | 'synced' | 'error';
  lastCookieSync?: number | null;
  cookieSyncDomains?: string[];
}

export interface E2EBrowserState {
  url: string;
  title: string;
  isVisible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  cookieSyncStatus?: string;
  lastCookieSync?: number | null;
  cookieSyncDomains?: string[];
}

export interface E2EOfflineInput {
  isOnline?: boolean;
  isBackendReachable?: boolean;
  pendingQueueCount?: number;
}

export interface E2EOfflineState {
  isOnline: boolean;
  isBackendReachable: boolean;
  syncState: string;
  pendingQueueCount: number;
}

export interface E2ESafetyInput {
  toolName?: string;
  target?: string;
  value?: string;
  thoughts?: string;
}

export interface E2ESafetyState {
  hasPendingTask: boolean;
  toolName: string | null;
  target?: string;
  thoughts?: string;
}

export interface E2ESettingsInput {
  theme?: ThemeName;
  fontSize?: 'small' | 'medium' | 'large';
  accentColor?: 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'pink' | 'orange' | 'blue';
  systemPrompt?: string;
  temperature?: number;
  modelName?: string;
  defaultAgent?: string;
  userName?: string;
  connectionMode?: ConnectionMode;
  apiUrl?: string;
  apiKey?: string;
}

function queryParams(): URLSearchParams {
  const location = (globalThis as { location?: { search?: string } }).location;
  return new URLSearchParams(location?.search ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until zustand's persisted state has rehydrated.
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
 */
export function seedChat(options: {
  threadId?: string;
  title?: string;
  agent?: string;
  messages?: Array<Pick<Message, 'role' | 'content'> & { id?: string }>;
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
        id: message.id || `e2e_seed_${index}`,
        role: message.role,
        content: message.content,
        created_at: '2026-01-01T12:00:00.000Z',
      })),
    );
  }

  return getChatState();
}

/**
 * Seed multiple threads with pinning, history, and active selection.
 */
export function seedThreads(threadsList: E2EThreadInput[], clearFirst = true): E2EThreadsState {
  const store = useChatStore.getState();
  if (clearFirst) store.clearStore();

  const constructedThreads: Thread[] = threadsList.map((t) => ({
    id: t.id,
    title: t.title,
    agent: t.agent || 'personal assistant',
    updated_at: new Date().toISOString(),
    is_pinned: Boolean(t.isPinned),
  }));

  const messagesMap: Record<string, Message[]> = { ...useChatStore.getState().messages };
  for (const t of threadsList) {
    if (t.messages && t.messages.length > 0) {
      messagesMap[t.id] = t.messages.map((m, index) => ({
        id: `seed_msg_${t.id}_${index}`,
        role: m.role,
        content: m.content,
        created_at: '2026-01-01T12:00:00.000Z',
      }));
    } else if (!messagesMap[t.id]) {
      messagesMap[t.id] = [];
    }
  }

  useChatStore.setState({
    threads: constructedThreads,
    messages: messagesMap,
    activeThreadId: threadsList.length > 0 ? threadsList[0].id : null,
  });

  return getThreadsState();
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

export function getThreadsState(): E2EThreadsState {
  const state = useChatStore.getState();
  return {
    activeThreadId: state.activeThreadId,
    threads: state.threads.map((t) => ({
      id: t.id,
      title: t.title,
      agent: t.agent || 'personal assistant',
      is_pinned: Boolean(t.is_pinned),
      messageCount: (state.messages[t.id] ?? []).length,
    })),
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
    theme: state.theme,
    accentColor: state.accentColor,
    fontSize: state.fontSize,
    temperature: state.temperature,
    systemPrompt: state.systemPrompt,
    modelName: state.modelName,
    userName: state.userName,
    deviceAgentPermissions: state.deviceAgentPermissions,
  };
}

export function seedSettings(settings: E2ESettingsInput): E2EConfigState {
  const store = useConfigStore.getState();
  if (settings.theme) store.setTheme(settings.theme);
  if (settings.fontSize) store.setFontSize(settings.fontSize);
  if (settings.accentColor) store.setAccentColor(settings.accentColor);
  if (settings.systemPrompt !== undefined) store.setSystemPrompt(settings.systemPrompt);
  if (settings.temperature !== undefined) store.setTemperature(settings.temperature);
  if (settings.modelName) store.setModelName(settings.modelName);
  if (settings.defaultAgent) store.setDefaultAgent(settings.defaultAgent);
  if (settings.userName) store.setUserName(settings.userName);
  if (settings.connectionMode) store.setConnectionMode(settings.connectionMode);
  if (settings.apiUrl !== undefined && settings.apiKey !== undefined) {
    store.setConfig(settings.apiUrl, settings.apiKey);
  }
  return getConfigState();
}

/**
 * Seed tasks into the in-browser SQLite database shim.
 */
export async function seedTasks(
  tasksList?: Array<Partial<TaskEntity>>,
  clearFirst = true,
): Promise<E2ETasksState> {
  await initializeDatabase();
  if (clearFirst) {
    await db.delete(tasks);
  }

  const defaultTasks: TaskEntity[] = [
    {
      id: 'task-e2e-001',
      title: 'Daily Briefing Automation',
      description: 'Fetch weather, calendar, and unread mail digest at 9am',
      status: 'active',
      recurrence_rule: '0 9 * * *',
      linked_agent: 'personal assistant',
      task_prompt: 'Generate my daily morning briefing.',
      connection_mode: 'server',
      last_run: 1704099600000,
      next_run: 1704186000000,
      created_at: 1704099600000,
    },
    {
      id: 'task-e2e-002',
      title: 'Weekly Summary Sync',
      description: 'Consolidate completed sprint items on Friday afternoon',
      status: 'paused',
      recurrence_rule: '0 18 * * 5',
      linked_agent: 'analyst',
      task_prompt: 'Summarize weekly accomplishments and tasks.',
      connection_mode: 'server',
      last_run: null,
      next_run: null,
      created_at: 1704099600000,
    },
    {
      id: 'task-e2e-003',
      title: 'Research Digest',
      description: 'Daily query for arXiv papers in AI agents',
      status: 'active',
      recurrence_rule: '0 12 * * 1-5',
      linked_agent: 'teacher',
      task_prompt: 'Search and summarize new papers.',
      connection_mode: 'server',
      last_run: 1704110400000,
      next_run: 1704196800000,
      created_at: 1704099600000,
    },
  ];

  const itemsToInsert = tasksList && tasksList.length > 0
    ? tasksList.map((t, idx) => ({
        id: t.id ?? `task-custom-${idx + 1}`,
        title: t.title ?? `Task ${idx + 1}`,
        description: t.description ?? null,
        status: (t.status ?? 'active') as 'active' | 'paused',
        recurrence_rule: t.recurrence_rule ?? '0 9 * * *',
        linked_agent: t.linked_agent ?? 'personal assistant',
        task_prompt: t.task_prompt ?? 'Default prompt',
        connection_mode: (t.connection_mode ?? 'server') as 'server' | 'local' | 'cloud',
        last_run: t.last_run ?? null,
        next_run: t.next_run ?? null,
        created_at: t.created_at ?? Date.now(),
      }))
    : defaultTasks;

  for (const item of itemsToInsert) {
    await db.insert(tasks).values(item);
  }

  return getTasksState();
}

export async function getTasksState(): Promise<E2ETasksState> {
  await initializeDatabase();
  const rows = (await db.select().from(tasks)) as TaskEntity[];
  return {
    tasks: rows,
    count: rows.length,
  };
}

export async function seedExecution(task: Partial<TaskEntity> = {}, execution: any = {}): Promise<void> {
  await initializeDatabase();
  const taskId = task.id || 'task-progress-demo';
  await db.insert(tasks).values({
    id: taskId,
    title: task.title || 'Data Migration Workflow',
    status: (task.status as any) || 'active',
    recurrence_rule: task.recurrence_rule || '0 9 * * *',
    linked_agent: task.linked_agent || 'analyst',
    task_prompt: task.task_prompt || 'Run migration steps.',
    connection_mode: (task.connection_mode as any) || 'server',
    created_at: task.created_at || Date.now(),
  });
  await db.insert(taskExecutions).values({
    id: execution.id || 'exec-demo-001',
    task_id: taskId,
    status: execution.status || 'running',
    current_step_index: execution.current_step_index || 0,
    started_at: execution.started_at || Date.now(),
  });
}

/**
 * Seed Google OAuth authenticated state.
 */
export function seedOAuth(options: E2EOAuthInput = {}): E2EOAuthState {
  const isConnected = options.isConnected ?? true;
  const email = options.email ?? 'e2e-tester@vela.local';
  const name = options.name ?? 'E2E Tester';
  const scopes: GoogleWorkspaceScope[] = options.scopes ?? [
    'openid',
    'profile',
    'email',
    'gmail.modify',
    'calendar.events',
    'drive.file',
  ];

  if (isConnected) {
    useGoogleAuthStore.getState().setTokens({
      accessToken: 'e2e-mock-google-access-token',
      refreshToken: 'e2e-mock-google-refresh-token',
      idToken: 'e2e-mock-google-id-token',
      expiresAt: Date.now() + 3600_000,
    });
    useGoogleAuthStore.getState().setUser({
      email,
      name,
      picture: 'https://example.com/avatar.png',
      sub: 'google-sub-12345',
    });
    useGoogleAuthStore.setState({ scopes, isConnected: true, error: null });
  } else {
    useGoogleAuthStore.getState().clearAuth();
  }

  return getOAuthState();
}

export function getOAuthState(): E2EOAuthState {
  const state = useGoogleAuthStore.getState();
  return {
    isConnected: state.isConnected,
    email: state.user?.email ?? null,
    scopes: state.scopes,
  };
}

/**
 * Seed In-App Browser state.
 */
export function seedBrowser(options: E2EBrowserInput = {}): E2EBrowserState {
  useBrowserStore.setState({
    currentUrl: options.url ?? 'https://example.com',
    pageTitle: options.title ?? 'Example Domain',
    isVisible: options.isVisible ?? true,
    canGoBack: options.canGoBack ?? false,
    canGoForward: options.canGoForward ?? false,
    isLoading: false,
    ...(options.cookieSyncStatus ? { cookieSyncStatus: options.cookieSyncStatus } : {}),
    ...(options.lastCookieSync !== undefined ? { lastCookieSync: options.lastCookieSync } : {}),
    ...(options.cookieSyncDomains ? { cookieSyncDomains: options.cookieSyncDomains } : {}),
  });
  return getBrowserState();
}

export function getBrowserState(): E2EBrowserState {
  const state = useBrowserStore.getState();
  return {
    url: state.currentUrl,
    title: state.pageTitle,
    isVisible: state.isVisible,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    cookieSyncStatus: state.cookieSyncStatus,
    lastCookieSync: state.lastCookieSync,
    cookieSyncDomains: state.cookieSyncDomains,
  };
}

/**
 * Seed Offline Sync store state.
 */
export function seedOffline(options: E2EOfflineInput = {}): E2EOfflineState {
  const store = useOfflineStore.getState();
  if (options.isOnline !== undefined) store.setOnline(options.isOnline);
  if (options.isBackendReachable !== undefined) store.setBackendReachable(options.isBackendReachable);
  if (options.pendingQueueCount !== undefined) store.setPendingQueueCount(options.pendingQueueCount);
  return getOfflineState();
}

export function getOfflineState(): E2EOfflineState {
  const state = useOfflineStore.getState();
  return {
    isOnline: state.isOnline,
    isBackendReachable: state.isBackendReachable,
    syncState: state.syncState,
    pendingQueueCount: state.pendingQueueCount,
  };
}

/**
 * Seed Safety Approval dialog state.
 */
export function seedSafety(options: E2ESafetyInput = {}): E2ESafetyState {
  const toolName = options.toolName ?? 'device_click';
  useSafetyStore.setState({
    pendingTask: {
      toolName,
      target: options.target ?? 'Send button',
      value: options.value,
      thoughts: options.thoughts ?? 'Requires user confirmation for safety tier',
      conversationId: E2E_THREAD_ID,
      resolve: () => {},
    },
  });
  return getSafetyState();
}

export function getSafetyState(): E2ESafetyState {
  const state = useSafetyStore.getState();
  return {
    hasPendingTask: state.pendingTask !== null,
    toolName: state.pendingTask?.toolName ?? null,
    target: state.pendingTask?.target,
    thoughts: state.pendingTask?.thoughts,
  };
}

/**
 * Simulate push notification payload delivery and routing.
 */
export async function simulatePushNotification(data: Record<string, string>): Promise<void> {
  const { selectThread } = useChatStore.getState();
  const parsed = parseNotificationData(data);
  if (parsed.conversation_id) {
    selectThread(parsed.conversation_id);
  }
  if (parsed.route) {
    goTo(parsed.route);
  } else {
    goTo('/');
  }
}

/**
 * Register push token with backend control channel.
 */
export async function simulateDeviceTokenRegistration(token: string): Promise<boolean> {
  const { apiUrl, apiKey } = useConfigStore.getState();
  if (!apiUrl || !apiKey) return false;
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/config/device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Seed briefing scenario.
 */
export async function seedBriefing(): Promise<{ ok: boolean }> {
  await configure();
  return { ok: true };
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

/**
 * Reset all state across the full stack:
 * 1. Wipe client Zustand stores
 * 2. Wipe SQLite DB shim
 * 3. Re-configure default connection
 * 4. Call backend POST /_e2e/reset
 */
export async function resetWorld(): Promise<void> {
  useChatStore.getState().clearStore();
  useGoogleAuthStore.getState().clearAuth();
  useBrowserStore.setState({
    currentUrl: 'about:blank',
    pageTitle: '',
    isVisible: false,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    pendingApproval: null,
    pendingAction: null,
    lastExecutedId: null,
    aiStatus: null,
    cookieSyncStatus: 'idle',
    lastCookieSync: null,
    cookieSyncDomains: [],
  });
  useSafetyStore.setState({ pendingTask: null });
  useOfflineStore.getState().reset();
  useConfigStore.getState().clearConfig();

  await resetE2EDatabase();
  await configure();

  try {
    const apiUrl = useConfigStore.getState().apiUrl || E2E_DEFAULT_API_URL;
    const res = await fetch(`${apiUrl}/_e2e/reset`, { method: 'POST' });
    if (!res.ok) {
      console.warn('[e2e] resetWorld backend call returned:', res.status);
    }
  } catch (err) {
    console.warn('[e2e] resetWorld backend call failed:', err);
  }
}

/**
 * Load a named scenario or domain fixture on the client side.
 */
export async function loadFixture(name: string): Promise<any> {
  switch (name) {
    case 'chat':
      return seedChat();
    case 'populated_threads':
      return seedThreads([
        {
          id: '00000000-0000-4000-8000-000000000001',
          title: 'Daily Standup & Objectives',
          agent: 'personal assistant',
          isPinned: true,
          messages: [
            { role: 'user', content: 'What are my priorities today?' },
            { role: 'assistant', content: '1. Review PR stack\n2. Sync with team at 10am.' },
          ],
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          title: 'Python Async Tutoring',
          agent: 'teacher',
          isPinned: false,
          messages: [
            { role: 'user', content: 'Explain asyncio.gather vs asyncio.TaskGroup.' },
            { role: 'assistant', content: 'TaskGroup handles cancellation cleanly upon child exceptions.' },
          ],
        },
        {
          id: '00000000-0000-4000-8000-000000000003',
          title: 'Quarterly Financial Analysis',
          agent: 'analyst',
          isPinned: true,
        },
        {
          id: '00000000-0000-4000-8000-000000000004',
          title: 'Creative Prompt Experiments',
          agent: 'prompt builder',
          isPinned: false,
        },
        {
          id: '00000000-0000-4000-8000-000000000005',
          title: 'Archived Architecture Review',
          agent: 'personal assistant',
          isPinned: false,
        },
      ]);
    case 'tasks':
      return await seedTasks();
    case 'oauth':
      return seedOAuth({ isConnected: true });
    case 'settings':
      return seedSettings({
        theme: 'aquatic',
        accentColor: 'emerald',
        temperature: 0.7,
        systemPrompt: 'E2E Custom System Prompt',
      });
    case 'browser':
      return seedBrowser({ url: 'https://example.com', title: 'Example Domain', isVisible: true });
    case 'briefing':
    case 'briefing_history':
      return seedBriefing();
    case 'offline':
      return seedOffline({ isOnline: false, pendingQueueCount: 3 });
    case 'safety':
      return seedSafety({ toolName: 'device_tap', target: 'Purchase Confirmation' });
    case 'error_turn':
    case 'delay_stream':
    case 'default':
      return { ok: true, fixture: name };
    default:
      console.warn(`[e2e] unknown client fixture name: ${name}`);
      return { ok: false, unknownFixture: name };
  }
}

const api = {
  configure,
  seedChat,
  getChatState,
  getConfigState,
  waitForIdle,
  goTo,
  seedTasks,
  getTasksState,
  seedExecution,
  seedSettings,
  seedThreads,
  getThreadsState,
  seedOAuth,
  getOAuthState,
  seedBriefing,
  seedBrowser,
  getBrowserState,
  seedOffline,
  getOfflineState,
  seedSafety,
  getSafetyState,
  simulatePushNotification,
  simulateDeviceTokenRegistration,
  loadFixture,
  resetWorld,
  version: 2 as const,
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
  if (params.get('e2e_unconfigured') === '1' || params.get('e2e_seed') === 'setup') {
    useConfigStore.getState().clearConfig();
    useChatStore.getState().clearStore();
    return api;
  }

  void configure({
    apiUrl: params.get('e2e_api_url') ?? undefined,
    apiKey: params.get('e2e_api_key') ?? undefined,
  })
    .then(async () => {
      const seedParam = params.get('e2e_seed');
      if (seedParam) {
        await loadFixture(seedParam);
      }
    })
    .catch((error) => {
      console.error('[e2e] loader seed failed', error);
    });

  return api;
}
