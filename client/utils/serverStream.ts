/**
 * Module: client/utils/serverStream
 * Intent: Shared server-mode SSE dispatch delegating lifecycle and token throttling to streamController.
 * Responsibilities: Title rename, error surfacing, and sync queueing for server streams used by
 *   send / regenerate / new-thread.
 * Public API: runServerStream(ServerStreamParams), type ServerStreamParams.
 * Invariants: Per-call-site divergences preserved — `threads` is optional (new-thread path omits the
 *   optimistic setThreads title update; see LEARNINGS "Extracted Shared Helpers Must Preserve Per-Call-Site Divergences").
 * Side Effects: streamController lifecycle delegation, store mutations, sync queue writes.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import type React from 'react';
import { useChatStore, Message, Thread } from '../store/useChatStore';
import { streamAgentResponse } from './sse';
import { queueMessageForSync } from '../db/chatRepository';
import { streamController } from './streamController';

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
  setThreads?: (threads: Thread[]) => void;
  setAuthRequired: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

// Shared server-mode SSE dispatch used by send, regenerate, and new-thread:
// delegates streaming lifecycle and token throttling to streamController.
export async function runServerStream(p: ServerStreamParams): Promise<void> {
  await streamController.startStream(p.threadId, async (signal) => {
    try {
      await streamAgentResponse(
        p.apiUrl,
        p.apiKey,
        p.threadId,
        p.prompt,
        (chunk) => {
          streamController.appendChunk(p.threadId, chunk);
        },
        (newTitle) => {
          if (newTitle) {
            if (p.threads && p.setThreads) {
              p.setThreads(p.threads.map((t) => (t.id === p.threadId ? { ...t, title: newTitle } : t)));
            }
            useChatStore.getState().renameThread(p.threadId, newTitle);
          }
        },
        (error) => {
          if (signal.aborted) return;
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          useChatStore.getState().appendToken(p.threadId, `\n\n⚠️ **Error:** ${errMsg}`);
          queueMessageForSync(p.threadId, p.syncUserEntry).catch(() => {});
        },
        signal,
        p.agent,
        (provider) => {
          if (provider === 'google' && p.threadId) {
            p.setAuthRequired((prev) => ({ ...prev, [p.threadId]: true }));
          }
        }
      );
    } catch (err: any) {
      if (signal.aborted) return;
      useChatStore.getState().appendToken(p.threadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
      queueMessageForSync(p.threadId, p.syncUserEntry).catch(() => {});
    }
  });
}
