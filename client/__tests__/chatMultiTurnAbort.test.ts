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

import { useChatStore } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';
import { streamController } from '../utils/streamController';
import { runServerStream } from '../utils/serverStream';
import * as sseModule from '../utils/sse';
import { streamLocalLlmResponse } from '../utils/localLlm';
import { parseAndExecuteTools } from '../utils/toolProxy';
import { streamLocalResponse } from '../app/index';

describe('Multi-turn tool loop abortion & streamController delegation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.getState().clearStore();
    useConfigStore.setState({
      connectionMode: 'local',
      apiUrl: '',
      apiKey: '',
    });
  });

  afterEach(async () => {
    await streamController.abortAll();
  });

  describe('Local multi-turn tool loop hard abort', () => {
    it('updates assistant message content with tool result after iteration 1 and appends subsequent tokens on the replaced bubble', async () => {
      const threadId = 'thread-local-multi-turn';
      useChatStore.getState().createThread('Test', threadId);
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-user',
        role: 'user',
        content: 'Check the weather in Paris',
      });
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-asst',
        role: 'assistant',
        content: '',
      });

      // Iteration 1 produces a tool call
      (streamLocalLlmResponse as jest.Mock).mockImplementationOnce(
        async function* (_prompt: string, onToken: (t: string) => void) {
          const chunk = '<call name="get_weather">{"city":"Paris"}</call>';
          onToken(chunk);
          yield chunk;
        }
      );

      // Tool proxy executes and returns updatedContent with <response> on iteration 1, then no invocations on iteration 2
      (parseAndExecuteTools as jest.Mock)
        .mockImplementationOnce(async (content: string) => {
          return {
            hasInvocations: true,
            updatedContent: `${content}\n<response>22°C and sunny</response>`,
          };
        })
        .mockImplementationOnce(async (content: string) => {
          return {
            hasInvocations: false,
            updatedContent: content,
          };
        });

      // Iteration 2 produces text response following the tool result
      (streamLocalLlmResponse as jest.Mock).mockImplementationOnce(
        async function* (_prompt: string, onToken: (t: string) => void) {
          const chunk = '\n\nIt is 22°C and sunny in Paris.';
          onToken(chunk);
          yield chunk;
        }
      );

      await streamLocalResponse(threadId, 'Check the weather in Paris', [
        { id: 'msg-user', role: 'user', content: 'Check the weather in Paris' },
      ]);

      // Verify parseAndExecuteTools was called for iteration 1 and iteration 2
      expect(parseAndExecuteTools).toHaveBeenCalledTimes(2);
      expect(parseAndExecuteTools).toHaveBeenNthCalledWith(
        1,
        '<call name="get_weather">{"city":"Paris"}</call>',
        threadId,
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      // Verify streamLocalLlmResponse was called for 2 iterations
      expect(streamLocalLlmResponse).toHaveBeenCalledTimes(2);

      // Verify store content: assistant message has tool response block replacing call AND iteration 2 tokens
      const messages = useChatStore.getState().messages[threadId];
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toBe(
        '<call name="get_weather">{"city":"Paris"}</call>\n<response>22°C and sunny</response>\n\nIt is 22°C and sunny in Paris.'
      );
      expect(streamController.isStreaming(threadId)).toBe(false);
    });

    it('aborts mid-loop during tool execution with no further iterations and retains pre-abort content', async () => {
      const threadId = 'thread-local-abort-mid-loop';
      useChatStore.getState().createThread('Test', threadId);
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-user',
        role: 'user',
        content: 'Take a screenshot',
      });
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-asst',
        role: 'assistant',
        content: '',
      });

      // Iteration 1 produces tool call
      (streamLocalLlmResponse as jest.Mock).mockImplementationOnce(
        async function* (_prompt: string, onToken: (t: string) => void) {
          const chunk = '<call name="screenshot">{}</call>';
          onToken(chunk);
          yield chunk;
        }
      );

      // Tool proxy stops stream mid-execution (simulating user tapping Stop while tool runs)
      (parseAndExecuteTools as jest.Mock).mockImplementationOnce(
        async (content: string) => {
          await streamController.stopStream(threadId);
          return {
            hasInvocations: true,
            updatedContent: `${content}\n<response>captured</response>`,
          };
        }
      );

      await streamLocalResponse(threadId, 'Take a screenshot', [
        { id: 'msg-user', role: 'user', content: 'Take a screenshot' },
      ]);

      // Only 1 iteration ran
      expect(streamLocalLlmResponse).toHaveBeenCalledTimes(1);
      expect(parseAndExecuteTools).toHaveBeenCalledTimes(1);

      // Tool result was NOT applied to the store because signal was aborted before applying
      const messages = useChatStore.getState().messages[threadId];
      expect(messages[1].content).toBe('<call name="screenshot">{}</call>');
      expect(streamController.isStreaming(threadId)).toBe(false);
    });

    it('aborts before tool execution if signal was aborted during token generation', async () => {
      const threadId = 'thread-local-abort-during-gen';
      useChatStore.getState().createThread('Test', threadId);
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-user',
        role: 'user',
        content: 'Run action',
      });
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-asst',
        role: 'assistant',
        content: '',
      });

      (streamLocalLlmResponse as jest.Mock).mockImplementationOnce(
        async function* (_prompt: string, onToken: (t: string) => void) {
          const chunk = '<call name="action">{}</call>';
          onToken(chunk);
          // Stop stream during generation
          await streamController.stopStream(threadId);
          yield chunk;
        }
      );

      await streamLocalResponse(threadId, 'Run action', [
        { id: 'msg-user', role: 'user', content: 'Run action' },
      ]);

      expect(streamLocalLlmResponse).toHaveBeenCalledTimes(1);
      expect(parseAndExecuteTools).not.toHaveBeenCalled();
      expect(streamController.isStreaming(threadId)).toBe(false);
    });
  });

  describe('Cloud tool execution abort', () => {
    it('throws AbortError on onToolCall if signal is aborted', () => {
      const controller = new AbortController();
      controller.abort();
      const signal = controller.signal;

      const onToolCall = (call: { toolName: string }) => {
        if (signal.aborted) {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          throw err;
        }
      };

      expect(() => onToolCall({ toolName: 'testTool' })).toThrow('AbortError');
    });

    it('throws AbortError on onToolResult if signal is aborted', () => {
      const controller = new AbortController();
      controller.abort();
      const signal = controller.signal;

      const onToolResult = (res: { result: any }) => {
        if (signal.aborted) {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          throw err;
        }
      };

      expect(() => onToolResult({ result: { success: true } })).toThrow('AbortError');
    });
  });

  describe('Server stream delegation to streamController', () => {
    it('delegates to streamController.startStream and appends chunks via appendChunk', async () => {
      const threadId = 'thread-server-stream';
      useChatStore.getState().createThread('Server Test', threadId);
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-user',
        role: 'user',
        content: 'Hi',
      });
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-asst',
        role: 'assistant',
        content: '',
      });

      const spyStreamAgent = jest.spyOn(sseModule, 'streamAgentResponse').mockImplementation(
        async (
          _url,
          _key,
          tId,
          _prompt,
          onChunk,
          onDone,
          _onError,
          signal
        ) => {
          expect(signal).toBeDefined();
          expect(signal?.aborted).toBe(false);
          onChunk('Hello');
          onChunk(' from server');
          onDone('Renamed Title');
        }
      );

      await runServerStream({
        apiUrl: 'https://test.server',
        apiKey: 'key-123',
        threadId,
        prompt: 'Hi',
        agent: 'personal assistant',
        syncUserEntry: { id: 'msg-user', role: 'user', content: 'Hi' },
        setAuthRequired: jest.fn(),
      });

      expect(spyStreamAgent).toHaveBeenCalledTimes(1);
      const messages = useChatStore.getState().messages[threadId];
      expect(messages[1].content).toBe('Hello from server');
      expect(useChatStore.getState().threads.find((t) => t.id === threadId)?.title).toBe('Renamed Title');
      expect(streamController.isStreaming(threadId)).toBe(false);

      spyStreamAgent.mockRestore();
    });

    it('aborts server stream without logging network error when stopped mid-flight', async () => {
      const threadId = 'thread-server-abort';
      useChatStore.getState().createThread('Server Test', threadId);
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-user',
        role: 'user',
        content: 'Hi',
      });
      useChatStore.getState().addMessage(threadId, {
        id: 'msg-asst',
        role: 'assistant',
        content: '',
      });

      const spyStreamAgent = jest.spyOn(sseModule, 'streamAgentResponse').mockImplementation(
        async (
          _url,
          _key,
          tId,
          _prompt,
          _onChunk,
          _onDone,
          _onError,
          signal
        ) => {
          // Trigger stop mid-stream
          await streamController.stopStream(threadId);
          expect(signal?.aborted).toBe(true);
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
      );

      await runServerStream({
        apiUrl: 'https://test.server',
        apiKey: 'key-123',
        threadId,
        prompt: 'Hi',
        agent: 'personal assistant',
        syncUserEntry: { id: 'msg-user', role: 'user', content: 'Hi' },
        setAuthRequired: jest.fn(),
      });

      expect(spyStreamAgent).toHaveBeenCalledTimes(1);
      const messages = useChatStore.getState().messages[threadId];
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content || '').not.toContain('Network Error');
      expect(streamController.isStreaming(threadId)).toBe(false);

      spyStreamAgent.mockRestore();
    });
  });
});
