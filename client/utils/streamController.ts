/**
 * Module: client/utils/streamController
 * Intent: Deep module owning all streaming orchestration, token throttling, tag healing,
 *         placeholder pruning, AbortController lifecycle, and backend /stop dispatch.
 * Responsibilities:
 *  - Manage AbortController instances per thread.
 *  - Accumulate raw token chunks and flush them to useChatStore on a 100ms throttle interval.
 *  - On stream stop/cleanup: flush pending tokens, heal unclosed XML tags with healXmlTags,
 *    prune empty or reasoning-only assistant placeholders, and clear interval timers.
 *  - In server connection mode: dispatch non-blocking, timeout-bounded POST /chat/threads/{id}/stop.
 *  - Provide abortAll for mass cancellation across threads (e.g. app backgrounding or unmount).
 * Public API:
 *  - interface StreamController
 *  - createStreamController(): StreamController (factory)
 *  - streamController: StreamController (default singleton instance)
 *  - Functional aliases: startStream, stopStream, isStreaming, abortAll, appendChunk, cleanup
 */

import { useChatStore } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';
import { healXmlTags } from './xmlHealer';
import { stripReasoning } from './reasoning';

export interface StreamController {
  /**
   * Contract: runner must honor the AbortSignal; appendChunk after stop is voided.
   */
  startStream(threadId: string, runner: (signal: AbortSignal) => Promise<void>): Promise<void>;
  stopStream(threadId: string): Promise<void>;
  isStreaming(threadId: string): boolean;
  abortAll(): Promise<void>;
  appendChunk(threadId: string, chunk: string): void;
  cleanup(threadId: string): void;
}

const BACKEND_STOP_TIMEOUT_MS = 3000;
const THROTTLE_INTERVAL_MS = 100;

function normalizeUrl(url: string): string {
  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  return formattedUrl.replace(/\/+$/, '');
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = BACKEND_STOP_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class StreamControllerImpl implements StreamController {
  private abortControllers = new Map<string, AbortController>();
  private throttleTimers: Record<string, ReturnType<typeof setInterval>> = {};
  private pendingTokens: Record<string, string> = {};

  private ensureThrottleTimer(threadId: string): void {
    if (this.throttleTimers[threadId]) return;
    this.throttleTimers[threadId] = setInterval(() => {
      if (!useChatStore.getState().isThreadStreaming(threadId)) {
        this.cleanup(threadId);
        return;
      }
      const pending = this.pendingTokens[threadId];
      if (pending) {
        useChatStore.getState().appendToken(threadId, pending);
        this.pendingTokens[threadId] = '';
      }
    }, THROTTLE_INTERVAL_MS);
  }

  private finalizeThread(threadId: string): void {
    // 3. Flush pending tokens immediately via useChatStore.getState().appendToken
    const pending = this.pendingTokens[threadId];
    if (pending) {
      useChatStore.getState().appendToken(threadId, pending);
    }
    delete this.pendingTokens[threadId];

    // 4. Apply healXmlTags to the last assistant message
    const threadMsgs = useChatStore.getState().messages[threadId] || [];
    if (threadMsgs.length > 0) {
      const last = threadMsgs[threadMsgs.length - 1];
      if (last.role === 'assistant') {
        const healed = healXmlTags(last.content || '');
        if (healed !== last.content) {
          const updatedHistory = [...threadMsgs.slice(0, -1), { ...last, content: healed }];
          useChatStore.setState((s) => ({
            messages: {
              ...s.messages,
              [threadId]: updatedHistory,
            },
          }));
        }
      }
    }

    // 5. Clean up throttle interval timers
    if (this.throttleTimers[threadId]) {
      clearInterval(this.throttleTimers[threadId]);
      delete this.throttleTimers[threadId];
    }

    // 6. Check if assistant message is empty or whitespace-only (or only unclosed reasoning that was stripped)
    const currentMsgs = useChatStore.getState().messages[threadId] || [];
    if (currentMsgs.length > 0) {
      const lastMsg = currentMsgs[currentMsgs.length - 1];
      if (lastMsg.role === 'assistant') {
        const stripped = stripReasoning(lastMsg.content || '', false).trim();
        if (!stripped) {
          if ((lastMsg.content || '').trim() !== '') {
            useChatStore.setState((s) => {
              const cur = s.messages[threadId] || [];
              if (cur.length === 0) return {};
              const l = cur[cur.length - 1];
              if (l.id !== lastMsg.id) return {};
              return {
                messages: {
                  ...s.messages,
                  [threadId]: [...cur.slice(0, -1), { ...l, content: '' }],
                },
              };
            });
          }
          useChatStore.getState().removeLastEmptyAssistant(threadId);
        }
      }
    }

    // 7. Call useChatStore.getState().setStreamingThread(threadId, false)
    useChatStore.getState().setStreamingThread(threadId, false);
  }

  async startStream(
    threadId: string,
    runner: (signal: AbortSignal) => Promise<void>
  ): Promise<void> {
    if (this.abortControllers.has(threadId)) {
      await this.stopStream(threadId);
    }

    const controller = new AbortController();
    this.abortControllers.set(threadId, controller);
    useChatStore.getState().setStreamingThread(threadId, true);

    try {
      await runner(controller.signal);
    } catch (err: any) {
      if (controller.signal.aborted) {
        return;
      }
      throw err;
    } finally {
      if (this.abortControllers.get(threadId) === controller) {
        this.cleanup(threadId);
      }
    }
  }

  async stopStream(threadId: string): Promise<void> {
    // 1. Abort local AbortController in registry for threadId
    const controller = this.abortControllers.get(threadId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(threadId);
    }

    // 2. If Server mode: send non-blocking fetch (${apiUrl}/chat/threads/${threadId}/stop) to notify backend
    const { connectionMode, apiUrl, apiKey } = useConfigStore.getState();
    if (connectionMode === 'server' && apiUrl && apiKey) {
      const normalizedUrl = normalizeUrl(apiUrl);
      fetchWithTimeout(
        `${normalizedUrl}/chat/threads/${threadId}/stop`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
            'Content-Type': 'application/json',
          },
        },
        BACKEND_STOP_TIMEOUT_MS
      ).catch((err) => {
        console.warn(`[StreamController] Backend stop notification failed for thread ${threadId}:`, err);
      });
    }

    // 3 - 7. Flush tokens, heal tags, clear timers, prune empty placeholder, setStreamingThread false
    this.finalizeThread(threadId);
  }

  isStreaming(threadId: string): boolean {
    const ctrl = this.abortControllers.get(threadId);
    const hasActiveCtrl = Boolean(ctrl && !ctrl.signal.aborted);
    return hasActiveCtrl || useChatStore.getState().isThreadStreaming(threadId);
  }

  appendChunk(threadId: string, chunk: string): void {
    if (!useChatStore.getState().isThreadStreaming(threadId)) {
      return;
    }
    this.pendingTokens[threadId] = (this.pendingTokens[threadId] || '') + chunk;
    this.ensureThrottleTimer(threadId);
  }

  cleanup(threadId: string): void {
    this.abortControllers.delete(threadId);
    this.finalizeThread(threadId);
  }

  async abortAll(): Promise<void> {
    const threadIds = new Set<string>([
      ...this.abortControllers.keys(),
      ...Object.keys(this.throttleTimers),
      ...useChatStore.getState().streamingThreadIds,
    ]);
    await Promise.all(Array.from(threadIds).map((id) => this.stopStream(id)));
  }
}

export function createStreamController(): StreamController {
  return new StreamControllerImpl();
}

export const streamController: StreamController = new StreamControllerImpl();

export const startStream = streamController.startStream.bind(streamController);
export const stopStream = streamController.stopStream.bind(streamController);
export const isStreaming = streamController.isStreaming.bind(streamController);
export const abortAll = streamController.abortAll.bind(streamController);
export const appendChunk = streamController.appendChunk.bind(streamController);
export const cleanup = streamController.cleanup.bind(streamController);
