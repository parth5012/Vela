jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
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
  isLocalDbAvailable: jest.fn(() => false),
}));

import { useChatStore } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';
import {
  streamController,
  createStreamController,
  StreamController,
} from '../utils/streamController';

describe('StreamController', () => {
  let controller: StreamController;
  let originalFetch: typeof global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    useChatStore.getState().clearStore();
    useConfigStore.setState({
      connectionMode: 'local',
      apiUrl: '',
      apiKey: '',
    });

    originalFetch = global.fetch;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'stopped', thread_id: 'test-thread' }),
    });
    global.fetch = fetchMock;

    controller = createStreamController();
  });

  afterEach(async () => {
    await controller.abortAll();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  function seedThread(threadId: string, assistantContent = '') {
    const store = useChatStore.getState();
    store.createThread('Test Thread', threadId);
    store.addMessage(threadId, {
      id: `${threadId}-user`,
      role: 'user',
      content: 'User query',
    });
    store.addMessage(threadId, {
      id: `${threadId}-assistant`,
      role: 'assistant',
      content: assistantContent,
    });
  }

  describe('startStream', () => {
    it('registers controller, sets streaming state in store, and executes runner with signal', async () => {
      seedThread('thread-1');
      let signalCaptured: AbortSignal | null = null;
      let isStreamingDuringRun = false;

      const runnerPromise = controller.startStream('thread-1', async (signal) => {
        signalCaptured = signal;
        isStreamingDuringRun = controller.isStreaming('thread-1');
        expect(signal.aborted).toBe(false);
        expect(useChatStore.getState().isThreadStreaming('thread-1')).toBe(true);
      });

      await runnerPromise;

      expect(signalCaptured).not.toBeNull();
      expect(isStreamingDuringRun).toBe(true);
      expect(controller.isStreaming('thread-1')).toBe(false);
      expect(useChatStore.getState().isThreadStreaming('thread-1')).toBe(false);
    });

    it('stops previous active stream on the same thread before starting a new one', async () => {
      seedThread('thread-dup', 'initial');
      let firstSignal: AbortSignal | null = null;

      const firstStreamPromise = controller.startStream('thread-dup', async (signal) => {
        firstSignal = signal;
        // Simulating long-running stream
        await new Promise((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
      });

      // Allow first stream to start
      await Promise.resolve();
      expect(controller.isStreaming('thread-dup')).toBe(true);

      let secondSignal: AbortSignal | null = null;
      const secondStreamPromise = controller.startStream('thread-dup', async (signal) => {
        secondSignal = signal;
      });

      await Promise.all([firstStreamPromise, secondStreamPromise]);

      expect((firstSignal as AbortSignal | null)?.aborted).toBe(true);
      expect((secondSignal as AbortSignal | null)?.aborted).toBe(false);
    });

    it('preserves newly added placeholder across duplicate startStream and appends token to it', async () => {
      const store = useChatStore.getState();
      store.createThread('Test Thread', 'thread-dup-turn');
      // Turn 1 setup
      store.addMessage('thread-dup-turn', {
        id: 'turn1-user',
        role: 'user',
        content: 'Turn 1 query',
      });
      store.addMessage('thread-dup-turn', {
        id: 'turn1-assistant',
        role: 'assistant',
        content: 'Turn 1 response',
      });

      let firstSignal: AbortSignal | null = null;
      const firstStreamPromise = controller.startStream('thread-dup-turn', async (signal) => {
        firstSignal = signal;
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      });

      await Promise.resolve();
      expect(controller.isStreaming('thread-dup-turn')).toBe(true);

      // Caller optimistically appends the NEW turn's user message + empty assistant placeholder BEFORE startStream
      store.addMessage('thread-dup-turn', {
        id: 'turn2-user',
        role: 'user',
        content: 'Turn 2 query',
      });
      store.addMessage('thread-dup-turn', {
        id: 'turn2-assistant',
        role: 'assistant',
        content: '',
      });

      let secondSignal: AbortSignal | null = null;
      let resolveSecondRunner: () => void;
      const secondRunnerGate = new Promise<void>((r) => {
        resolveSecondRunner = r;
      });

      const secondStreamPromise = controller.startStream('thread-dup-turn', async (signal) => {
        secondSignal = signal;
        await secondRunnerGate;
      });

      // Allow Turn 2 to execute: stops Turn 1, sets up Turn 2 stream
      await Promise.resolve();
      await firstStreamPromise;

      expect((firstSignal as AbortSignal | null)?.aborted).toBe(true);
      expect((secondSignal as AbortSignal | null)?.aborted).toBe(false);

      // Assert new placeholder survives (not pruned by previous stream's stop)
      const messages = useChatStore.getState().messages['thread-dup-turn'];
      expect(messages).toHaveLength(4);
      expect(messages[3].id).toBe('turn2-assistant');
      expect(messages[3].role).toBe('assistant');
      expect(messages[3].content).toBe('');

      // Using real store: appendToken onto the new turn lands on that assistant message after previous stream's finalize ran
      useChatStore.getState().appendToken('thread-dup-turn', 'First chunk of turn 2');
      const updatedMessages = useChatStore.getState().messages['thread-dup-turn'];
      expect(updatedMessages).toHaveLength(4);
      expect(updatedMessages[3].id).toBe('turn2-assistant');
      expect(updatedMessages[3].content).toBe('First chunk of turn 2');

      resolveSecondRunner!();
      await secondStreamPromise;
    });
  });

  describe('stopStream', () => {
    it('aborts controller signal and halts runner', async () => {
      seedThread('thread-abort', 'content');
      let signalReceived: AbortSignal | null = null;
      let abortEventFired = false;

      const streamPromise = controller.startStream('thread-abort', async (signal) => {
        signalReceived = signal;
        signal.addEventListener('abort', () => {
          abortEventFired = true;
        });
        await new Promise((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
      });

      await Promise.resolve();
      expect(controller.isStreaming('thread-abort')).toBe(true);

      await controller.stopStream('thread-abort');

      expect((signalReceived as AbortSignal | null)?.aborted).toBe(true);
      expect(abortEventFired).toBe(true);
      expect(controller.isStreaming('thread-abort')).toBe(false);
      expect(useChatStore.getState().isThreadStreaming('thread-abort')).toBe(false);

      await streamPromise;
    });

    it('flushes pending tokens immediately via appendToken', async () => {
      seedThread('thread-flush', 'Hello');
      useChatStore.getState().setStreamingThread('thread-flush', true);

      controller.appendChunk('thread-flush', ' world');
      controller.appendChunk('thread-flush', '!');

      // Stop before interval fires
      await controller.stopStream('thread-flush');

      const messages = useChatStore.getState().messages['thread-flush'];
      expect(messages[1].content).toBe('Hello world!');
    });

    it('applies healXmlTags to the last assistant message', async () => {
      seedThread('thread-heal', '<thought>Thinking about answer');
      useChatStore.getState().setStreamingThread('thread-heal', true);

      await controller.stopStream('thread-heal');

      const messages = useChatStore.getState().messages['thread-heal'];
      expect(messages[1].content).toBe('<thought>Thinking about answer</thought>');
    });

    it('sends non-blocking fetch to backend in server mode', async () => {
      useConfigStore.setState({
        connectionMode: 'server',
        apiUrl: 'https://api.vela.local',
        apiKey: 'secret-token-123',
      });
      seedThread('thread-server', 'content');

      await controller.stopStream('thread-server');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vela.local/chat/threads/thread-server/stop',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer secret-token-123',
            'Content-Type': 'application/json',
          },
          signal: expect.any(Object),
        })
      );
    });

    it('does not send backend stop fetch in local or cloud modes', async () => {
      useConfigStore.setState({
        connectionMode: 'cloud',
        apiUrl: 'https://api.vela.local',
        apiKey: 'secret-token-123',
      });
      seedThread('thread-cloud', 'content');

      await controller.stopStream('thread-cloud');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('handles backend stop network failure gracefully without throwing', async () => {
      useConfigStore.setState({
        connectionMode: 'server',
        apiUrl: 'https://api.vela.local',
        apiKey: 'secret-token-123',
      });
      fetchMock.mockRejectedValueOnce(new Error('Network error'));
      seedThread('thread-fail', 'content');

      await expect(controller.stopStream('thread-fail')).resolves.not.toThrow();
    });

    it('does not send backend stop fetch in server mode when notifyBackend is false, but still aborts and finalizes', async () => {
      useConfigStore.setState({
        connectionMode: 'server',
        apiUrl: 'https://api.vela.local',
        apiKey: 'secret-token-123',
      });
      seedThread('thread-server-no-notify', 'content');

      let signalCaptured: AbortSignal | null = null;
      const streamPromise = controller.startStream('thread-server-no-notify', async (signal) => {
        signalCaptured = signal;
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      });

      await Promise.resolve();
      expect(controller.isStreaming('thread-server-no-notify')).toBe(true);

      await controller.stopStream('thread-server-no-notify', { notifyBackend: false });

      expect(fetchMock).not.toHaveBeenCalled();
      expect((signalCaptured as AbortSignal | null)?.aborted).toBe(true);
      expect(controller.isStreaming('thread-server-no-notify')).toBe(false);
      expect(useChatStore.getState().isThreadStreaming('thread-server-no-notify')).toBe(false);

      await streamPromise;
    });

    it('sends current stream_generation in server mode stop fetch body, increasing monotonically across startStreams and cleanups', async () => {
      useConfigStore.setState({
        connectionMode: 'server',
        apiUrl: 'https://api.vela.local',
        apiKey: 'secret-token-123',
      });
      seedThread('thread-gen', 'content');

      // First stream
      let s1: AbortSignal | null = null;
      const p1 = controller.startStream('thread-gen', async (signal) => {
        s1 = signal;
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      });
      await Promise.resolve();

      // Second stream on same thread stops first stream
      let s2: AbortSignal | null = null;
      const p2 = controller.startStream('thread-gen', async (signal) => {
        s2 = signal;
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      });
      await Promise.resolve();
      await p1;

      // Stop call from stopping stream 1
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call1 = fetchMock.mock.calls[0];
      expect(JSON.parse(call1[1].body)).toEqual({ stream_generation: 1 });

      // Stop stream 2 explicitly
      await controller.stopStream('thread-gen');
      await p2;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const call2 = fetchMock.mock.calls[1];
      expect(JSON.parse(call2[1].body)).toEqual({ stream_generation: 2 });

      // Clean up thread
      controller.cleanup('thread-gen');

      // Third stream after cleanup starts at generation 3
      fetchMock.mockClear();
      let s3: AbortSignal | null = null;
      const p3 = controller.startStream('thread-gen', async (signal) => {
        s3 = signal;
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      });
      await Promise.resolve();

      await controller.stopStream('thread-gen');
      await p3;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call3 = fetchMock.mock.calls[0];
      expect(JSON.parse(call3[1].body)).toEqual({ stream_generation: 3 });
    });

    it('prunes empty assistant placeholder when stopped before content arrives', async () => {
      seedThread('thread-empty', '');
      expect(useChatStore.getState().messages['thread-empty']).toHaveLength(2);

      await controller.stopStream('thread-empty');

      const messages = useChatStore.getState().messages['thread-empty'];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('prunes assistant placeholder if content is only whitespace', async () => {
      seedThread('thread-whitespace', '   \n  \t ');
      expect(useChatStore.getState().messages['thread-whitespace']).toHaveLength(2);

      await controller.stopStream('thread-whitespace');

      const messages = useChatStore.getState().messages['thread-whitespace'];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('prunes assistant placeholder if content only contains stripped reasoning', async () => {
      useChatStore.getState().createThread('Test Thread', 'thread-reasoning');
      useChatStore.getState().setHistory('thread-reasoning', [
        { id: 'user-1', role: 'user', content: 'User query' },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '<think>Internal thinking without visible output',
        },
      ]);
      expect(useChatStore.getState().messages['thread-reasoning'][1].content).toBe(
        '<think>Internal thinking without visible output'
      );
      useChatStore.getState().setStreamingThread('thread-reasoning', true);

      await controller.stopStream('thread-reasoning');

      const messages = useChatStore.getState().messages['thread-reasoning'];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('preserves assistant message when visible content exists', async () => {
      seedThread('thread-visible', 'Visible answer');
      expect(useChatStore.getState().messages['thread-visible']).toHaveLength(2);

      await controller.stopStream('thread-visible');

      const messages = useChatStore.getState().messages['thread-visible'];
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toBe('Visible answer');
    });
  });

  describe('appendChunk and throttle timer', () => {
    it('throttles chunks to 100ms interval ticks', () => {
      seedThread('thread-throttle', '');
      useChatStore.getState().setStreamingThread('thread-throttle', true);

      controller.appendChunk('thread-throttle', 'chunk1');
      expect(useChatStore.getState().messages['thread-throttle'][1].content).toBe('');

      jest.advanceTimersByTime(100);
      expect(useChatStore.getState().messages['thread-throttle'][1].content).toBe('chunk1');

      controller.appendChunk('thread-throttle', 'chunk2');
      controller.appendChunk('thread-throttle', 'chunk3');
      expect(useChatStore.getState().messages['thread-throttle'][1].content).toBe('chunk1');

      jest.advanceTimersByTime(100);
      expect(useChatStore.getState().messages['thread-throttle'][1].content).toBe('chunk1chunk2chunk3');
    });

    it('self-heals and flushes pending tokens if thread is marked not streaming in store', () => {
      seedThread('thread-self-heal', 'Base');
      useChatStore.getState().setStreamingThread('thread-self-heal', true);

      controller.appendChunk('thread-self-heal', '-extra');
      // Externally mark not streaming
      useChatStore.getState().setStreamingThread('thread-self-heal', false);

      jest.advanceTimersByTime(100);

      // Pending chunk tail is flushed during self-heal cleanup
      expect(useChatStore.getState().messages['thread-self-heal'][1].content).toBe('Base-extra');

      // Subsequent advance does not fire
      jest.advanceTimersByTime(500);
      expect(useChatStore.getState().messages['thread-self-heal'][1].content).toBe('Base-extra');
    });

    it('voids appendChunk after stop', () => {
      seedThread('thread-void', 'Base');
      expect(useChatStore.getState().isThreadStreaming('thread-void')).toBe(false);

      controller.appendChunk('thread-void', '-extra');

      jest.advanceTimersByTime(200);
      expect(useChatStore.getState().messages['thread-void'][1].content).toBe('Base');
    });
  });

  describe('abortAll', () => {
    it('aborts every active stream across all threads', async () => {
      seedThread('thread-all-1', '');
      seedThread('thread-all-2', '');
      seedThread('thread-all-3', '');

      let sig1: AbortSignal | null = null;
      let sig2: AbortSignal | null = null;

      const p1 = controller.startStream('thread-all-1', async (signal) => {
        sig1 = signal;
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      });

      const p2 = controller.startStream('thread-all-2', async (signal) => {
        sig2 = signal;
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      });

      // thread 3 has an empty assistant message and is streaming in store
      useChatStore.getState().setStreamingThread('thread-all-3', true);

      await Promise.resolve();

      expect(controller.isStreaming('thread-all-1')).toBe(true);
      expect(controller.isStreaming('thread-all-2')).toBe(true);

      await controller.abortAll();

      expect((sig1 as AbortSignal | null)?.aborted).toBe(true);
      expect((sig2 as AbortSignal | null)?.aborted).toBe(true);
      expect(controller.isStreaming('thread-all-1')).toBe(false);
      expect(controller.isStreaming('thread-all-2')).toBe(false);
      expect(controller.isStreaming('thread-all-3')).toBe(false);

      // Thread 3 empty assistant pruned
      expect(useChatStore.getState().messages['thread-all-3']).toHaveLength(1);

      await Promise.all([p1, p2]);
    });

    it('forwards notifyBackend: false option to each thread stop', async () => {
      useConfigStore.setState({
        connectionMode: 'server',
        apiUrl: 'https://api.vela.local',
        apiKey: 'secret-token-123',
      });
      seedThread('thread-abortall-server', 'content');

      let sig: AbortSignal | null = null;
      const p = controller.startStream('thread-abortall-server', async (signal) => {
        sig = signal;
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      });
      await Promise.resolve();

      await controller.abortAll({ notifyBackend: false });

      expect(fetchMock).not.toHaveBeenCalled();
      expect((sig as AbortSignal | null)?.aborted).toBe(true);
      expect(controller.isStreaming('thread-abortall-server')).toBe(false);

      await p;
    });
  });

  describe('module singleton instance export', () => {
    it('exports streamController default singleton conforming to interface', () => {
      expect(typeof streamController.startStream).toBe('function');
      expect(typeof streamController.stopStream).toBe('function');
      expect(typeof streamController.isStreaming).toBe('function');
      expect(typeof streamController.abortAll).toBe('function');
      expect(typeof streamController.appendChunk).toBe('function');
      expect(typeof streamController.cleanup).toBe('function');
    });
  });
});
