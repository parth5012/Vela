/**
 * Module: client/utils/serverStream
 * Intent: Shared server-mode SSE dispatch + streaming throttle timer (extracted verbatim from app/index.tsx).
 * Responsibilities: token throttling (100ms flush), title rename, error surfacing, sync queueing for
 *   server streams used by send / regenerate / new-thread.
 * Public API: runServerStream(ServerStreamParams), ensureThrottleTimer(...), type ServerStreamParams.
 * Invariants: Per-call-site divergences preserved — `threads` is optional (new-thread path omits the
 *   optimistic setThreads title update; see LEARNINGS "Extracted Shared Helpers Must Preserve Per-Call-Site Divergences").
 * Side Effects: AbortController registry mutation, interval timers, store mutations, sync queue writes.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import type React from 'react';
import { useChatStore, Message, Thread } from '../store/useChatStore';
import { streamAgentResponse } from './sse';
import { queueMessageForSync } from '../db/chatRepository';

// Start the 100ms flush timer for a streaming thread if it isn't running yet.
// FIX-3: the tick self-heals when a stream ends without explicit cleanup.
export function ensureThrottleTimer(
  threadId: string,
  throttleTimers: { current: Record<string, any> },
  pendingTokens: { current: Record<string, string> },
  appendToken: (threadId: string, token: string) => void,
  cleanUpThrottleAndHeal: (threadId: string) => void
): void {
  if (throttleTimers.current[threadId]) return;
  throttleTimers.current[threadId] = setInterval(() => {
    if (!useChatStore.getState().isThreadStreaming(threadId)) {
      cleanUpThrottleAndHeal(threadId);
      return;
    }
    if (pendingTokens.current[threadId]) {
      appendToken(threadId, pendingTokens.current[threadId]);
      pendingTokens.current[threadId] = '';
    }
  }, 100);
}

export type ServerStreamParams = {
  apiUrl: string;
  apiKey: string;
  threadId: string;
  prompt: string;
  agent: string;
  /** User message to queue for sync if the stream fails (onError + network catch). */
  syncUserEntry: Message;
  /** Threads snapshot for the optimistic title update; omit to persist only via renameThread. */
  threads?: Thread[];
  abortControllers: { current: Record<string, AbortController> };
  throttleTimers: { current: Record<string, any> };
  pendingTokens: { current: Record<string, string> };
  appendToken: (threadId: string, token: string) => void;
  setStreamingThread: (threadId: string, isStreaming: boolean) => void;
  setThreads: (threads: Thread[]) => void;
  setAuthRequired: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  cleanUpThrottleAndHeal: (threadId: string) => void;
};

// Shared server-mode SSE dispatch used by send, regenerate, and new-thread:
// token throttling, title rename, error surfacing, and sync queueing.
export async function runServerStream(p: ServerStreamParams): Promise<void> {
  const controller = new AbortController();
  p.abortControllers.current[p.threadId] = controller;

  try {
    await streamAgentResponse(
      p.apiUrl,
      p.apiKey,
      p.threadId,
      p.prompt,
      (chunk) => {
        p.pendingTokens.current[p.threadId] = (p.pendingTokens.current[p.threadId] || '') + chunk;
        ensureThrottleTimer(p.threadId, p.throttleTimers, p.pendingTokens, p.appendToken, p.cleanUpThrottleAndHeal);
      },
      (newTitle) => {
        p.setStreamingThread(p.threadId, false);
        delete p.abortControllers.current[p.threadId];
        p.cleanUpThrottleAndHeal(p.threadId);
        useChatStore.getState().removeLastEmptyAssistant(p.threadId);
        if (newTitle) {
          if (p.threads) {
            p.setThreads(p.threads.map((t) => (t.id === p.threadId ? { ...t, title: newTitle } : t)));
          }
          useChatStore.getState().renameThread(p.threadId, newTitle);
        }
      },
      (error) => {
        p.setStreamingThread(p.threadId, false);
        delete p.abortControllers.current[p.threadId];
        p.cleanUpThrottleAndHeal(p.threadId);
        useChatStore.getState().removeLastEmptyAssistant(p.threadId);
        const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
        p.appendToken(p.threadId, `\n\n⚠️ **Error:** ${errMsg}`);
        queueMessageForSync(p.threadId, p.syncUserEntry).catch(() => {});
      },
      controller.signal,
      p.agent,
      (provider) => {
        if (provider === 'google' && p.threadId) {
          p.setAuthRequired((prev) => ({ ...prev, [p.threadId]: true }));
        }
      }
    );
  } catch (err: any) {
    p.setStreamingThread(p.threadId, false);
    p.cleanUpThrottleAndHeal(p.threadId);
    useChatStore.getState().removeLastEmptyAssistant(p.threadId);
    p.appendToken(p.threadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
    queueMessageForSync(p.threadId, p.syncUserEntry).catch(() => {});
  }
}
