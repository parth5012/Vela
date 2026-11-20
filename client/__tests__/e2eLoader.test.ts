/**
 * Unit test suite for client/e2e/loader.ts seam methods.
 */
process.env.EXPO_PUBLIC_E2E = '1';

jest.mock('expo-router', () => ({
  router: {
    navigate: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  },
}));

import {
  configure,
  seedChat,
  getChatState,
  getConfigState,
  seedSettings,
  seedThreads,
  getThreadsState,
  seedTasks,
  getTasksState,
  seedOAuth,
  getOAuthState,
  seedBrowser,
  getBrowserState,
  seedOffline,
  getOfflineState,
  seedSafety,
  getSafetyState,
  loadFixture,
  resetWorld,
} from '../e2e/loader';

describe('E2E Loader Seam', () => {
  beforeEach(async () => {
    // Mock global fetch for backend reset
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as any;

    await resetWorld();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures server mode and retrieves config state', async () => {
    const config = await configure({ apiUrl: 'http://localhost:8123', apiKey: 'custom-key' });
    expect(config.connectionMode).toBe('server');
    expect(config.apiUrl).toBe('http://localhost:8123');
    expect(config.hasApiKey).toBe(true);
    expect(config.isConfigured).toBe(true);
  });

  it('seeds single chat thread and returns chat state', () => {
    const chat = seedChat({
      threadId: 'test-thread-1',
      title: 'Unit Test Thread',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(chat.threadId).toBe('test-thread-1');
    expect(chat.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(chat.streaming).toBe(false);
  });

  it('seeds multiple threads with pin states and history', () => {
    const threadsState = seedThreads([
      { id: 't1', title: 'Thread 1', isPinned: true },
      { id: 't2', title: 'Thread 2', isPinned: false },
    ]);
    expect(threadsState.threads.length).toBe(2);
    expect(threadsState.threads[0].is_pinned).toBe(true);
    expect(threadsState.threads[1].is_pinned).toBe(false);
  });

  it('seeds settings and theme appearance', () => {
    const settings = seedSettings({
      theme: 'citrus',
      accentColor: 'amber',
      temperature: 0.8,
      systemPrompt: 'You are an agent.',
    });
    expect(settings.theme).toBe('citrus');
    expect(settings.accentColor).toBe('amber');
    expect(settings.temperature).toBe(0.8);
    expect(settings.systemPrompt).toBe('You are an agent.');
  });

  it('seeds tasks into in-memory SQLite shim and reads them back', async () => {
    const res = await seedTasks([
      { id: 'custom-task-1', title: 'Test Task', status: 'active', recurrence_rule: '0 9 * * *', task_prompt: 'Run now' },
    ]);
    expect(res.count).toBe(1);
    expect(res.tasks[0].id).toBe('custom-task-1');
    expect(res.tasks[0].title).toBe('Test Task');

    const state = await getTasksState();
    expect(state.count).toBe(1);
  });

  it('seeds OAuth authenticated state and clears it', () => {
    const oauth = seedOAuth({ isConnected: true, email: 'user@test.org' });
    expect(oauth.isConnected).toBe(true);
    expect(oauth.email).toBe('user@test.org');

    const disconnected = seedOAuth({ isConnected: false });
    expect(disconnected.isConnected).toBe(false);
    expect(disconnected.email).toBeNull();
  });

  it('seeds in-app browser state', () => {
    const browser = seedBrowser({ url: 'https://example.com/test', title: 'Test Page', isVisible: true });
    expect(browser.url).toBe('https://example.com/test');
    expect(browser.isVisible).toBe(true);

    const state = getBrowserState();
    expect(state.title).toBe('Test Page');
  });

  it('seeds offline sync state', () => {
    const offline = seedOffline({ isOnline: false, isBackendReachable: false, pendingQueueCount: 5 });
    expect(offline.isOnline).toBe(false);
    expect(offline.pendingQueueCount).toBe(5);

    const state = getOfflineState();
    expect(state.syncState).toBe('offline');
  });

  it('seeds safety approval dialog state', () => {
    const safety = seedSafety({ toolName: 'device_tap', target: 'Confirm Button' });
    expect(safety.hasPendingTask).toBe(true);
    expect(safety.toolName).toBe('device_tap');

    const state = getSafetyState();
    expect(state.target).toBe('Confirm Button');
  });

  it('loads fixtures across diverse domains', async () => {
    await loadFixture('tasks');
    const tasks = await getTasksState();
    expect(tasks.count).toBe(3);

    await loadFixture('oauth');
    const oauth = getOAuthState();
    expect(oauth.isConnected).toBe(true);

    await loadFixture('browser');
    const browser = getBrowserState();
    expect(browser.isVisible).toBe(true);
  });

  it('resets world cleanly across all stores and database', async () => {
    await seedTasks();
    seedOAuth({ isConnected: true });
    seedBrowser({ isVisible: true });
    seedSettings({ theme: 'warm', fontSize: 18, temperature: 0.9 });

    await resetWorld();

    const tasks = await getTasksState();
    expect(tasks.count).toBe(0);

    const oauth = getOAuthState();
    expect(oauth.isConnected).toBe(false);

    const browser = getBrowserState();
    expect(browser.isVisible).toBe(false);

    const config = getConfigState();
    expect(config.theme).toBe('berry');
    expect(config.fontSize).toBe('medium');
    expect(config.temperature).toBe(0.7);
  });
});
