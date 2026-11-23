import { create } from 'zustand';
import { db } from '../db/client';
import { messages, operationLog } from '../db/schema';
import { eq, or } from 'drizzle-orm';
import { generateUlid } from '../utils/syncIds';
import { useChatStore } from './useChatStore';

export interface ConflictedMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  provider?: string;
  conversation_id: string;
}

export interface SyncConflict {
  id: string;
  conversation_id: string;
  localMessage: ConflictedMessageData;
  serverMessage: ConflictedMessageData;
}

export type ConflictResolution = 'local' | 'server' | 'both';

export interface SyncConflictState {
  conflicts: SyncConflict[];
  addConflict: (conflict: SyncConflict) => void;
  removeConflict: (id: string) => void;
  clearConflicts: () => void;
  resolveConflict: (id: string, resolution: ConflictResolution) => Promise<void>;
}

export const useSyncConflictStore = create<SyncConflictState>((set, get) => ({
  conflicts: [],

  addConflict: (conflict: SyncConflict) =>
    set((state) => {
      if (state.conflicts.some((c) => c.id === conflict.id)) {
        return state;
      }
      return { conflicts: [...state.conflicts, conflict] };
    }),

  removeConflict: (id: string) =>
    set((state) => ({
      conflicts: state.conflicts.filter((c) => c.id !== id),
    })),

  clearConflicts: () => set({ conflicts: [] }),

  resolveConflict: async (id: string, resolution: ConflictResolution) => {
    const conflict = get().conflicts.find((c) => c.id === id);
    if (!conflict) return;

    if (resolution === 'local') {
      // Keep Local:
      // Local message remains in messages with pending = true.
      // Ensure an operationLog entry exists so it will be pushed on next sync.
      if (db) {
        try {
          await db
            .update(messages)
            .set({ pending: true })
            .where(or(eq(messages.id, conflict.localMessage.id), eq(messages.id, conflict.id)));

          await db
            .insert(operationLog)
            .values({
              id: conflict.localMessage.id,
              type: 'message',
              conversation_id: conflict.conversation_id,
              payload: JSON.stringify({
                role: conflict.localMessage.role,
                content: conflict.localMessage.content,
                provider: 'android_client',
                created_at: conflict.localMessage.created_at,
              }),
              created_at: conflict.localMessage.created_at,
            })
            .onConflictDoNothing();
        } catch (err) {
          console.warn('[useSyncConflictStore] Error preserving local conflict:', err);
        }
      }
    } else if (resolution === 'server') {
      // Keep Server:
      // Overwrite local message with server message and clear pending state
      if (db) {
        try {
          await db
            .update(messages)
            .set({
              content: conflict.serverMessage.content,
              role: conflict.serverMessage.role,
              provider: conflict.serverMessage.provider || 'remote',
              created_at: conflict.serverMessage.created_at,
              pending: false,
              server_id: conflict.serverMessage.id,
            })
            .where(or(eq(messages.id, conflict.localMessage.id), eq(messages.id, conflict.id)));

          await db
            .delete(operationLog)
            .where(or(eq(operationLog.id, conflict.localMessage.id), eq(operationLog.id, conflict.id)));
        } catch (err) {
          console.warn('[useSyncConflictStore] Error accepting server conflict:', err);
        }
      }

      // Update in-memory chatStore if loaded
      try {
        useChatStore.setState((state) => {
          const list = state.messages[conflict.conversation_id];
          if (!list) return state;
          const updated = list.map((m) =>
            m.id === conflict.localMessage.id || m.id === conflict.id
              ? {
                  ...m,
                  content: conflict.serverMessage.content,
                  role: conflict.serverMessage.role,
                }
              : m
          );
          return {
            messages: {
              ...state.messages,
              [conflict.conversation_id]: updated,
            },
          };
        });
      } catch (err) {
        console.warn('[useSyncConflictStore] Error updating in-memory chatStore:', err);
      }
    } else if (resolution === 'both') {
      // Keep Both:
      // 1. Original ID becomes server version (pending = false)
      // 2. Local version duplicated with new ID, content marked with indicator (*), pending = true
      const duplicateId = generateUlid();
      const duplicateContent = `${conflict.localMessage.content} *`;
      const now = Date.now();

      if (db) {
        try {
          // Accept server message for original ID
          await db
            .update(messages)
            .set({
              content: conflict.serverMessage.content,
              role: conflict.serverMessage.role,
              provider: conflict.serverMessage.provider || 'remote',
              created_at: conflict.serverMessage.created_at,
              pending: false,
              server_id: conflict.serverMessage.id,
            })
            .where(or(eq(messages.id, conflict.localMessage.id), eq(messages.id, conflict.id)));

          await db
            .delete(operationLog)
            .where(or(eq(operationLog.id, conflict.localMessage.id), eq(operationLog.id, conflict.id)));

          // Insert duplicate message for local content
          await db.insert(messages).values({
            id: duplicateId,
            conversation_id: conflict.conversation_id,
            role: conflict.localMessage.role,
            content: duplicateContent,
            provider: conflict.localMessage.provider || 'android_client',
            created_at: now,
            pending: true,
            server_id: null,
          });

          // Queue duplicate in operationLog for next push
          await db.insert(operationLog).values({
            id: duplicateId,
            type: 'message',
            conversation_id: conflict.conversation_id,
            payload: JSON.stringify({
              role: conflict.localMessage.role,
              content: duplicateContent,
              provider: 'android_client',
              created_at: now,
            }),
            created_at: now,
          });
        } catch (err) {
          console.warn('[useSyncConflictStore] Error keeping both in conflict:', err);
        }
      }

      // Update in-memory chatStore if loaded
      try {
        useChatStore.setState((state) => {
          const list = state.messages[conflict.conversation_id];
          if (!list) return state;
          const updated = list.map((m) =>
            m.id === conflict.localMessage.id || m.id === conflict.id
              ? {
                  ...m,
                  content: conflict.serverMessage.content,
                  role: conflict.serverMessage.role,
                }
              : m
          );
          return {
            messages: {
              ...state.messages,
              [conflict.conversation_id]: [
                ...updated,
                {
                  id: duplicateId,
                  role: conflict.localMessage.role,
                  content: duplicateContent,
                  created_at: new Date(now).toISOString(),
                },
              ],
            },
          };
        });
      } catch (err) {
        console.warn('[useSyncConflictStore] Error updating in-memory chatStore:', err);
      }
    }

    // Finally remove from conflicts queue
    get().removeConflict(id);
  },
}));
