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

const mockStreamLocalLlmResponse = jest.fn(
  async function* (_prompt: string, onToken?: (token: string) => void, _signal?: AbortSignal) {
    if (onToken) onToken('Local response chunk');
    yield 'Local response chunk';
  }
);
const mockInitializeLocalModel = jest.fn(
  async (_throwOnFallback?: boolean, _modelNameOverride?: string) => {
    localLlmMockState.isLocalModelLoaded = true;
  }
);

const localLlmMockState = {
  isLocalModelLoaded: false,
};

jest.mock('../utils/localLlm', () => ({
  get isLocalModelLoaded() {
    return localLlmMockState.isLocalModelLoaded;
  },
  initializeLocalModel: (throwOnFallback?: boolean, modelNameOverride?: string) =>
    mockInitializeLocalModel(throwOnFallback, modelNameOverride),
  streamLocalLlmResponse: (prompt: string, onToken?: (token: string) => void, signal?: AbortSignal) =>
    mockStreamLocalLlmResponse(prompt, onToken, signal),
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

  it('initializes local model before streaming in local mode if unloaded', async () => {
    useConfigStore.setState({ connectionMode: 'local' });
    localLlmMockState.isLocalModelLoaded = false;

    await sendQuickChatMessage('Local test prompt');

    expect(mockInitializeLocalModel).toHaveBeenCalledTimes(1);
    expect(mockStreamLocalLlmResponse).toHaveBeenCalledWith(
      'Local test prompt',
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('reports error and does not stream if local model initialization fails in local mode', async () => {
    useConfigStore.setState({ connectionMode: 'local' });
    localLlmMockState.isLocalModelLoaded = false;
    mockInitializeLocalModel.mockRejectedValueOnce(new Error('Model weights missing'));

    await sendQuickChatMessage('Local fail prompt');

    expect(mockInitializeLocalModel).toHaveBeenCalledTimes(1);
    expect(mockStreamLocalLlmResponse).not.toHaveBeenCalled();

    const messages = useChatStore.getState().messages[QUICK_CHAT_THREAD_ID] || [];
    const assistantMessage = messages.find((m) => m.role === 'assistant');
    expect(assistantMessage?.content).toContain('Model weights missing');
  });
});
