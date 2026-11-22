jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

jest.mock('../db/chatRepository', () => ({
  saveThread: jest.fn(async () => {}),
  saveThreads: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {}),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: jest.fn(async () => {}),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('../db/agentRepository', () => ({
  getCachedAgents: jest.fn(() => []),
}));

import { useChatStore } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';
import {
  QUICK_CHAT_THREAD_ID,
  getOrCreateQuickChatThread,
  sendQuickChatMessage,
} from '../utils/quickChatSync';
import * as chatRepo from '../db/chatRepository';

describe('quickChatSync (#596, #599)', () => {
  beforeEach(() => {
    useChatStore.getState().clearStore();
    useConfigStore.getState().clearConfig();
    jest.clearAllMocks();
  });

  it('creates and returns the dedicated Quick Chat thread if absent', () => {
    const thread = getOrCreateQuickChatThread();
    expect(thread.id).toBe(QUICK_CHAT_THREAD_ID);
    expect(thread.title).toBe('Quick Chat');
    expect(thread.is_pinned).toBe(true);

    const threadsInStore = useChatStore.getState().threads;
    expect(threadsInStore.some((t) => t.id === QUICK_CHAT_THREAD_ID)).toBe(true);
    expect(chatRepo.saveThread).toHaveBeenCalledWith(expect.objectContaining({ id: QUICK_CHAT_THREAD_ID }));
  });

  it('reuses the existing Quick Chat thread without duplicate creation', () => {
    const thread1 = getOrCreateQuickChatThread();
    const thread2 = getOrCreateQuickChatThread();
    expect(thread1.id).toBe(thread2.id);

    const matching = useChatStore.getState().threads.filter((t) => t.id === QUICK_CHAT_THREAD_ID);
    expect(matching.length).toBe(1);
  });

  it('sends user and assistant messages to the Quick Chat thread', async () => {
    await sendQuickChatMessage('Hello from floating overlay');

    const messages = useChatStore.getState().messages[QUICK_CHAT_THREAD_ID] || [];
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const userMessage = messages[0];
    expect(userMessage.role).toBe('user');
    expect(userMessage.content).toBe('Hello from floating overlay');

    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe('assistant');
    expect(chatRepo.saveMessage).toHaveBeenCalledWith(
      QUICK_CHAT_THREAD_ID,
      expect.objectContaining({ content: 'Hello from floating overlay' })
    );
  });

  it('ignores empty prompts without attachments', async () => {
    await sendQuickChatMessage('   ');
    const messages = useChatStore.getState().messages[QUICK_CHAT_THREAD_ID] || [];
    expect(messages.length).toBe(0);
  });
});
