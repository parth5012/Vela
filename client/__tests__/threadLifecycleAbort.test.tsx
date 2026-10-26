import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ closeDrawer: jest.fn() }),
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

const mockSaveMessage = jest.fn(async (_threadId?: string, _message?: any) => {});
const mockSaveThread = jest.fn(async (_thread?: any) => {});
const mockDeleteThreadLocal = jest.fn(async (_threadId?: string) => {});
const mockClearChatLocal = jest.fn(async () => {});

jest.mock('../db/chatRepository', () => ({
  saveThread: (thread: any) => mockSaveThread(thread),
  saveThreads: jest.fn(async () => {}),
  saveMessage: (threadId: string, message: any) => mockSaveMessage(threadId, message),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: (threadId: string) => mockDeleteThreadLocal(threadId),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: () => mockClearChatLocal(),
  isLocalDbAvailable: jest.fn(() => true),
}));

import { useChatStore } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';
import { streamController } from '../utils/streamController';
import ThreadRow from '../components/ui/ThreadRow';
import DrawerContent from '../components/ui/DrawerContent';

describe('Thread Lifecycle Auto-Abort & Drawer Streaming Indicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useChatStore.getState().clearStore();
      useConfigStore.setState({
        connectionMode: 'local',
        apiUrl: '',
        apiKey: '',
        theme: 'deep',
        fontSize: 'medium',
        accentColor: 'indigo',
      });
    });
  });

  afterEach(async () => {
    await streamController.abortAll();
    act(() => {
      useChatStore.getState().clearStore();
    });
  });

  describe('deleteThread auto-abort & leak prevention', () => {
    it('aborts active stream in streamController when thread is deleted', async () => {
      const store = useChatStore.getState();
      const threadId = 'thread-abort-1';
      store.createThread('Test Thread', threadId);

      let capturedSignal: AbortSignal | null = null;
      let streamRunning = true;

      // Start stream
      const streamPromise = streamController.startStream(threadId, async (signal) => {
        capturedSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            streamRunning = false;
            resolve();
          });
        });
      });

      expect(streamController.isStreaming(threadId)).toBe(true);
      expect(useChatStore.getState().isThreadStreaming(threadId)).toBe(true);
      expect(capturedSignal).not.toBeNull();
      expect(capturedSignal!.aborted).toBe(false);

      const stopSpy = jest.spyOn(streamController, 'stopStream');

      // Delete the thread
      act(() => {
        useChatStore.getState().deleteThread(threadId);
      });

      expect(stopSpy).toHaveBeenCalledWith(threadId);
      expect(capturedSignal!.aborted).toBe(true);
      expect(streamRunning).toBe(false);
      expect(streamController.isStreaming(threadId)).toBe(false);
      expect(useChatStore.getState().isThreadStreaming(threadId)).toBe(false);
      expect(useChatStore.getState().threads.find((t) => t.id === threadId)).toBeUndefined();
      expect(useChatStore.getState().messages[threadId]).toBeUndefined();

      await streamPromise;
      stopSpy.mockRestore();
    });

    it('cancels pending persist debounce so deleted thread never writes to SQLite', () => {
      jest.useFakeTimers();
      try {
        const store = useChatStore.getState();
        const threadId = 'thread-debounce-test';
        store.createThread('Debounce Thread', threadId);
        store.addMessage(threadId, { id: 'm1', role: 'assistant', content: 'Partial token' });

        // Appending token schedules a persist debounce timer
        store.appendToken(threadId, ' more tokens');
        mockSaveMessage.mockClear();

        // Delete the thread before debounce fires (800ms)
        store.deleteThread(threadId);

        // Fast-forward past the 800ms debounce
        jest.advanceTimersByTime(1000);

        // saveMessage should NOT have been called for the deleted thread
        expect(mockSaveMessage).not.toHaveBeenCalledWith(threadId, expect.anything());
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('clearStore mass abortAll', () => {
    it('aborts all active streams across threads when store is cleared', async () => {
      const store = useChatStore.getState();
      const t1 = 'thread-mass-1';
      const t2 = 'thread-mass-2';
      store.createThread('Thread 1', t1);
      store.createThread('Thread 2', t2);

      let signal1: AbortSignal | null = null;
      let signal2: AbortSignal | null = null;

      const p1 = streamController.startStream(t1, async (signal) => {
        signal1 = signal;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      });

      const p2 = streamController.startStream(t2, async (signal) => {
        signal2 = signal;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      });

      expect(streamController.isStreaming(t1)).toBe(true);
      expect(streamController.isStreaming(t2)).toBe(true);
      expect(useChatStore.getState().streamingThreadIds.size).toBe(2);

      const abortAllSpy = jest.spyOn(streamController, 'abortAll');

      // Clear store
      act(() => {
        useChatStore.getState().clearStore();
      });

      expect(abortAllSpy).toHaveBeenCalled();
      expect(signal1!.aborted).toBe(true);
      expect(signal2!.aborted).toBe(true);
      expect(streamController.isStreaming(t1)).toBe(false);
      expect(streamController.isStreaming(t2)).toBe(false);
      expect(useChatStore.getState().threads).toHaveLength(0);
      expect(useChatStore.getState().streamingThreadIds.size).toBe(0);

      await Promise.all([p1, p2]);
      abortAllSpy.mockRestore();
    });
  });

  describe('ThreadRow & DrawerContent streaming pulse indicator', () => {
    const mockColors = {
      card: '#1a1a1a',
      glassBorder: '#333333',
      text: '#ffffff',
      textMuted: '#888888',
      textDark: '#555555',
    };
    const accentHex = '#6366f1';
    const testThread = {
      id: 'thread-indicator-1',
      title: 'Indicator Thread',
      updated_at: '2026-10-26T12:00:00Z',
    };

    it('renders the subtle pulsing dot beside thread title when streaming is true', () => {
      let component: renderer.ReactTestRenderer | undefined;
      act(() => {
        component = renderer.create(
          <ThreadRow
            thread={testThread}
            isActive={false}
            streaming={true}
            colors={mockColors}
            accentHex={accentHex}
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
        );
      });

      const indicator = component!.root.findByProps({ testID: 'thread-streaming-indicator' });
      expect(indicator).toBeDefined();

      const flattened = StyleSheet.flatten(indicator.props.style);
      expect(flattened.backgroundColor).toBe(accentHex);
      expect(flattened.width).toBe(6);
      expect(flattened.height).toBe(6);
      expect(flattened.borderRadius).toBe(3);

      act(() => component!.unmount());
    });

    it('does not render the streaming dot when streaming is false', () => {
      let component: renderer.ReactTestRenderer | undefined;
      act(() => {
        component = renderer.create(
          <ThreadRow
            thread={testThread}
            isActive={false}
            streaming={false}
            colors={mockColors}
            accentHex={accentHex}
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
        );
      });

      const indicators = component!.root.findAllByProps({ testID: 'thread-streaming-indicator' });
      expect(indicators).toHaveLength(0);

      act(() => component!.unmount());
    });

    it('stops animation loop cleanly on unmount mid-stream', () => {
      const stop = jest.fn();
      const start = jest.fn();
      const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop } as any);

      let component: renderer.ReactTestRenderer | undefined;
      act(() => {
        component = renderer.create(
          <ThreadRow
            thread={testThread}
            isActive={false}
            streaming={true}
            colors={mockColors}
            accentHex={accentHex}
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
        );
      });

      expect(start).toHaveBeenCalled();

      act(() => {
        component!.unmount();
      });

      expect(stop).toHaveBeenCalled();
      loopSpy.mockRestore();
    });

    it('renders the streaming indicator in DrawerContent when thread is in streamingThreadIds', () => {
      const store = useChatStore.getState();
      const t1 = 'drawer-thread-1';
      act(() => {
        store.createThread('Background Task', t1);
        store.setStreamingThread(t1, true);
      });

      let component: renderer.ReactTestRenderer | undefined;
      act(() => {
        component = renderer.create(<DrawerContent />);
      });

      const threadRow = component!.root.findByType(ThreadRow);
      expect(threadRow.props.streaming).toBe(true);

      const indicator = component!.root.findByProps({ testID: 'thread-streaming-indicator' });
      expect(indicator).toBeDefined();

      const hostDots = component!.root.findAll(
        (node) => String(node.type) === 'View' && node.props?.testID === 'thread-streaming-indicator'
      );
      expect(hostDots).toHaveLength(1);

      act(() => {
        component!.unmount();
      });
    });
  });
});
