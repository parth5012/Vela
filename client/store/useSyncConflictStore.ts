import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../db/client';
import { messages, operationLog } from '../db/schema';
import { eq, or } from 'drizzle-orm';
import { generateUlid } from '../utils/syncIds';
import { useChatStore } from './useChatStore';

const CONFLICTS_STORAGE_KEY = '@sync_conflicts_v1';

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
  resolvingIds: string[];
  hydrateConflicts: () => Promise<void>;
  addConflict: (conflict: SyncConflict) => void;
  removeConflict: (id: string) => void;
  clearConflicts: () => void;
  resolveConflict: (id: string, resolution: ConflictResolution) => Promise<void>;
}

async function persistConflictsToStorage(conflicts: SyncConflict[]): Promise<void> {
  try {
    if (conflicts.length > 0) {
      await AsyncStorage.setItem(CONFLICTS_STORAGE_KEY, JSON.stringify(conflicts));
    } else {
      await AsyncStorage.removeItem(CONFLICTS_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[useSyncConflictStore] Failed to persist conflicts to AsyncStorage:', err);
  }
}

export const useSyncConflictStore = create<SyncConflictState>((set, get) => ({
  conflicts: [],
  resolvingIds: [],

  hydrateConflicts: async () => {
    try {
      const raw = await AsyncStorage.getItem(CONFLICTS_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (Array.isArray(stored)) {
          set({ conflicts: stored });
        }
      }
    } catch (err) {
      console.warn('[useSyncConflictStore] Failed to hydrate conflicts from AsyncStorage:', err);
    }
  },

  addConflict: (conflict: SyncConflict) =>
    set((state) => {
      if (state.conflicts.some((c) => c.id === conflict.id)) {
        return state;
      }
      const updated = [...state.conflicts, conflict];
      void persistConflictsToStorage(updated);
      return { conflicts: updated };
    }),

  removeConflict: (id: string) =>
    set((state) => {
      const updated = state.conflicts.filter((c) => c.id !== id);
      void persistConflictsToStorage(updated);
      return { conflicts: updated };
    }),

  clearConflicts: () => {
    void persistConflictsToStorage([]);
    set({ conflicts: [], resolvingIds: [] });
  },

  resolveConflict: async (id: string, resolution: ConflictResolution) => {
    if (get().resolvingIds.includes(id)) {
      return;
    }

    const conflict = get().conflicts.find((c) => c.id === id);
    if (!conflict) return;

    set((state) => ({ resolvingIds: [...state.resolvingIds, id] }));

    try {
      const runInTx = async (fn: (runner: any) => Promise<void>) => {
        if (db) {
          if (typeof (db as any).transaction === 'function') {
            await (db as any).transaction(fn);
          } else {
            await fn(db);
          }
        }
      };

      if (resolution === 'local') {
        // Keep Local:
        // Local message remains in messages with pending = true.
        // Ensure an operationLog entry exists so it will be pushed on next sync.
        await runInTx(async (tx) => {
          await tx
            .update(messages)
            .set({ pending: true })
            .where(or(eq(messages.id, conflict.localMessage.id), eq(messages.id, conflict.id)));

          await tx
            .insert(operationLog)
            .values({
              id: conflict.localMessage.id,
              type: 'message',
              conversation_id: conflict.conversation_id,
              payload: JSON.stringify({
                role: conflict.localMessage.role,
                content: conflict.localMessage.content,
                provider: conflict.localMessage.provider || 'android_client',
                created_at: conflict.localMessage.created_at,
              }),
              created_at: conflict.localMessage.created_at,
            })
            .onConflictDoNothing();
        });
      } else if (resolution === 'server') {
        // Keep Server:
        // Overwrite local message with server message and clear pending state
        await runInTx(async (tx) => {
          await tx
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

          await tx
            .delete(operationLog)
            .where(or(eq(operationLog.id, conflict.localMessage.id), eq(operationLog.id, conflict.id)));
        });

        // Update in-memory chatStore if loaded
        try {
          useChatStore.setState((state) => {
            const list = state.messages[conflict.conversation_id];
            if (!list) return state;
            return {
              messages: {
                ...state.messages,
                [conflict.conversation_id]: list.map((m) =>
                  m.id === conflict.localMessage.id || m.id === conflict.id
                    ? {
                        ...m,
                        content: conflict.serverMessage.content,
                        role: conflict.serverMessage.role,
                        created_at: new Date(conflict.serverMessage.created_at).toISOString(),
                      }
                    : m
                ),
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

        await runInTx(async (tx) => {
          // Accept server message for original ID
          await tx
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

          await tx
            .delete(operationLog)
            .where(or(eq(operationLog.id, conflict.localMessage.id), eq(operationLog.id, conflict.id)));

          // Insert duplicate message for local content
          await tx.insert(messages).values({
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
          await tx.insert(operationLog).values({
            id: duplicateId,
            type: 'message',
            conversation_id: conflict.conversation_id,
            payload: JSON.stringify({
              role: conflict.localMessage.role,
              content: duplicateContent,
              provider: conflict.localMessage.provider || 'android_client',
              created_at: now,
            }),
            created_at: now,
          });
        });

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
                    created_at: new Date(conflict.serverMessage.created_at).toISOString(),
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

      // Remove from conflicts queue only after resolution completes
      get().removeConflict(id);
    } catch (err) {
      console.error('[useSyncConflictStore] Error resolving conflict (conflict retained):', err);
      throw err;
    } finally {
      set((state) => ({ resolvingIds: state.resolvingIds.filter((rid) => rid !== id) }));
    }
  },
}));
