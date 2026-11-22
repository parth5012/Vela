/**
 * Quick Chat Thread Synchronization Utility (#596, #599)
 *
 * Manages the dedicated "Quick Chat" thread and real-time message streaming
 * between the floating overlay and the main app state.
 */
import { useChatStore, type Message, type Thread, type ChatAttachment } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';
import { DEFAULT_AGENT_ID } from './agents';
import { generateUlid } from './syncIds';
import { saveThread, saveMessage } from '../db/chatRepository';
import { streamController } from './streamController';
import { runServerStream } from './serverStream';
import { streamCloudResponse } from './providers';
import { getCachedAgents } from '../db/agentRepository';

export const QUICK_CHAT_THREAD_ID = 'quick-chat-thread';

/**
 * Returns the existing Quick Chat thread or creates one if it does not yet exist.
 * Pinned and titled "Quick Chat".
 */
export function getOrCreateQuickChatThread(): Thread {
  const state = useChatStore.getState();
  const existing = state.threads.find((t) => t.id === QUICK_CHAT_THREAD_ID);
  if (existing) {
    return existing;
  }

  const defaultAgent = useConfigStore.getState().defaultAgent || DEFAULT_AGENT_ID;
  const now = new Date().toISOString();
  const newThread: Thread = {
    id: QUICK_CHAT_THREAD_ID,
    title: 'Quick Chat',
    agent: defaultAgent,
    updated_at: now,
    is_pinned: true,
  };

  useChatStore.setState((s) => ({
    threads: [newThread, ...s.threads.filter((t) => t.id !== QUICK_CHAT_THREAD_ID)],
    messages: {
      ...s.messages,
      [QUICK_CHAT_THREAD_ID]: s.messages[QUICK_CHAT_THREAD_ID] || [],
    },
  }));

  saveThread(newThread).catch(() => {});
  return newThread;
}

/**
 * Sends a message into the Quick Chat thread and streams the assistant reply.
 */
export async function sendQuickChatMessage(
  prompt: string,
  attachments?: ChatAttachment[]
): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed && (!attachments || attachments.length === 0)) {
    return;
  }

  const thread = getOrCreateQuickChatThread();
  const threadId = QUICK_CHAT_THREAD_ID;
  const userMsgId = generateUlid();

  const userMessage: Message = {
    id: userMsgId,
    role: 'user',
    content: trimmed,
    created_at: new Date().toISOString(),
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  };

  const assistantMsgId = generateUlid();
  const assistantMessage: Message = {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    created_at: new Date().toISOString(),
  };

  useChatStore.getState().addMessage(threadId, userMessage);
  useChatStore.getState().addMessage(threadId, assistantMessage);
  saveMessage(threadId, userMessage).catch(() => {});

  const config = useConfigStore.getState();
  const connectionMode = config.connectionMode;

  if (connectionMode === 'server' && config.apiUrl && config.apiKey) {
    await runServerStream({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      threadId,
      prompt: trimmed,
      agent: thread.agent || DEFAULT_AGENT_ID,
      syncUserEntry: userMessage,
      setAuthRequired: () => {},
      attachments,
      cloudPrivacyConsent: config.cloudPrivacyConsent,
    });
    return;
  }

  if (connectionMode === 'cloud') {
    const provider = config.activeCloudProvider || 'gemini';
    const providerConfig = config.cloudProviders?.[provider];
    const apiKey = config.cloudApiKeys?.[provider] || '';
    const agents = getCachedAgents();
    const activeAgent = agents.find((a) => a.id === thread.agent);
    const model = activeAgent?.model?.trim() || providerConfig?.model || 'gemini-1.5-flash';

    await streamController.startStream(threadId, async (signal) => {
      try {
        const historySnapshot = useChatStore.getState().messages[threadId] || [];
        const payloadMessages = historySnapshot
          .filter((m) => m.id !== assistantMsgId)
          .map((m) => ({
            role: m.role,
            content: m.content,
          }));

        await streamCloudResponse({
          provider,
          apiKey,
          model,
          messages: payloadMessages,
          onToken: (token: string) => {
            if (!signal.aborted) {
              streamController.appendChunk(threadId, token);
            }
          },
          onDone: () => {},
          onError: (error) => {
            if (signal.aborted) return;
            streamController.appendChunk(
              threadId,
              `\n\n⚠️ **[${provider.toUpperCase()} Error]** ${error?.message || 'Cloud inference failed.'}`
            );
          },
        });
      } catch (err: unknown) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        streamController.appendChunk(threadId, `\n\n⚠️ **Error:** ${msg || 'Streaming failed.'}`);
      }
    });
    return;
  }

  // Local / unconfigured fallback response
  await streamController.startStream(threadId, async (signal) => {
    if (signal.aborted) return;
    const isConfigured = config.isConfigured;
    const response = isConfigured
      ? `Quick Chat received: "${trimmed}". Local engine ready.`
      : 'Vela Quick Chat is ready. Please configure your API key or connection in Settings to enable live assistant responses.';
    streamController.appendChunk(threadId, response);
  });
}
