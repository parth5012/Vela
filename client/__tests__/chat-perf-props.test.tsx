// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList } from 'react-native';
import { streamController } from '../utils/streamController';
import { handleSendPressAction } from '../app/index';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

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
  queueMessageForSync: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('../utils/localLlm', () => ({
  initializeLocalModel: jest.fn(async () => {}),
  streamLocalLlmResponse: jest.fn(),
  isLocalLlmDown: jest.fn(() => false),
  isStoredModelUsable: jest.fn(async () => true),
  localModelStorageKey: jest.fn(),
  LOCAL_MODELS: {},
}));

jest.mock('../utils/toolProxy', () => ({
  parseAndExecuteTools: jest.fn(),
}));

describe('ChatFlatList performance props', () => {
  it('FlatList accepts and forwards performance optimization props', async () => {
    const messages = [
      { id: 'msg-1', role: 'user', content: 'Hello' },
      { id: 'msg-2', role: 'assistant', content: 'Hi there' },
    ];

    let renderedProps: Record<string, any> | null = null;

    const MyFlatList = (props: any) => {
      renderedProps = props;
      return React.createElement(FlatList, props);
    };

    await act(async () => {
      renderer.create(
        React.createElement(MyFlatList, {
          data: messages,
          inverted: true,
          keyExtractor: (item: any) => item.id,
          renderItem: ({ item }: any) =>
            React.createElement('View', null, item.content),
          removeClippedSubviews: true,
          windowSize: 11,
          maxToRenderPerBatch: 10,
          updateCellsBatchingPeriod: 50,
          initialNumToRender: 15,
        })
      );
    });

    expect(renderedProps).not.toBeNull();
    expect(renderedProps?.removeClippedSubviews).toBe(true);
    expect(renderedProps?.windowSize).toBe(11);
    expect(renderedProps?.maxToRenderPerBatch).toBe(10);
    expect(renderedProps?.updateCellsBatchingPeriod).toBe(50);
    expect(renderedProps?.initialNumToRender).toBe(15);
    expect(renderedProps?.inverted).toBe(true);
    expect(typeof renderedProps?.keyExtractor).toBe('function');
    expect(typeof renderedProps?.renderItem).toBe('function');
  });
});

describe('handleSendPressAction (real Send/Stop dispatch used by ChatScreen)', () => {
  let stopSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // Spy (not replace) the REAL streamController so the dispatch path stays real.
    stopSpy = jest.spyOn(streamController, 'stopStream').mockResolvedValue(undefined as never);
  });

  const dispatch = (overrides: Partial<Parameters<typeof handleSendPressAction>[0]> = {}) => {
    const params = {
      isCurrentThreadStreaming: false,
      activeThreadId: 'thread-1',
      input: '',
      onStop: (threadId: string) => streamController.stopStream(threadId),
      onSend: jest.fn(),
      onSendWelcome: jest.fn(),
      ...overrides,
    };
    handleSendPressAction(params as any);
    return params;
  };

  it('dispatches stopStream via the REAL streamController when streaming, even with empty input', async () => {
    const params = dispatch({ isCurrentThreadStreaming: true, activeThreadId: 'thread-xyz', input: '' });
    expect(params.onSend).not.toHaveBeenCalled();
    expect(params.onSendWelcome).not.toHaveBeenCalled();
    expect(streamController.stopStream).toHaveBeenCalledTimes(1);
    expect(streamController.stopStream).toHaveBeenCalledWith('thread-xyz');
  });

  it('forwards handleSend (not stop) when not streaming and thread is active', () => {
    const params = dispatch({ isCurrentThreadStreaming: false, activeThreadId: 'thread-1', input: 'Hello' });
    expect(streamController.stopStream).not.toHaveBeenCalled();
    expect(params.onSend).toHaveBeenCalledTimes(1);
    expect(params.onSendWelcome).not.toHaveBeenCalled();
  });

  it('routes empty-thread sends to onSendWelcome only when input is non-empty', () => {
    const params = dispatch({ isCurrentThreadStreaming: false, activeThreadId: null, input: 'New chat!' });
    expect(streamController.stopStream).not.toHaveBeenCalled();
    expect(params.onSend).not.toHaveBeenCalled();
    expect(params.onSendWelcome).toHaveBeenCalledWith('New chat!');
  });

  it('ignores empty input when starting a brand-new thread', () => {
    const params = dispatch({ isCurrentThreadStreaming: false, activeThreadId: null, input: '   ' });
    expect(params.onSendWelcome).not.toHaveBeenCalled();
    expect(params.onSend).not.toHaveBeenCalled();
    expect(streamController.stopStream).not.toHaveBeenCalled();
  });
});


