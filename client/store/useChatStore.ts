import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfigStore } from './useConfigStore';
import { initializeDatabase } from '../db/client';
import {
  saveThread,
  saveThreads,
  saveMessage,
  saveMessages,
  deleteThreadLocal,
  deleteMessageLocal,
  replaceThreadMessages,
  hydrateChatFromLocalDb,
  clearChatLocal,
  isLocalDbAvailable,
} from '../db/chatRepository';

// Trailing debounce (ms) for persisting streaming assistant content: tokens
// arrive frequently during a stream, so we only write the final content once
// the stream settles. Timers are only scheduled when SQLite is available,
// so tests never accumulate dangling timers.
const PERSIST_DEBOUNCE_MS = 800;
const persistDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function scheduleMessagePersist(threadId: string) {
  if (!isLocalDbAvailable()) return;
  if (persistDebounceTimers[threadId]) {
    clearTimeout(persistDebounceTimers[threadId]);
  }
  persistDebounceTimers[threadId] = setTimeout(() => {
    delete persistDebounceTimers[threadId];
    const state = useChatStore.getState();
    const list = state.messages[threadId] || [];
    const last = list[list.length - 1];
    if (last) {
      saveMessage(threadId, last).catch(() => {});
    }
  }, PERSIST_DEBOUNCE_MS);
}

// zustand's persist middleware writes the full partialized state to storage on
// EVERY set(), even before the initial hydration read has completed. On app
// launch the startup effects in _layout.tsx / index.tsx call set() while the
// store is still in its empty initial state, which would overwrite the
// persisted chats with `{threads: [], activeThreadId: null, messages: {}}`.
// Guard the storage so writes are dropped until the first successful read.
let storageHydratedOnce = false;

const guardedAsyncStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } finally {
      storageHydratedOnce = true;
    }
  },
  setItem: async (name, value) => {
    if (!storageHydratedOnce) return;
    await AsyncStorage.setItem(name, value);
  },
  removeItem: async (name) => {
    if (!storageHydratedOnce) return;
    await AsyncStorage.removeItem(name);
  },
};

const normalizeUrl = (url: string): string => {
  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  return formattedUrl.replace(/\/+$/, '');
};

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface Thread {
  id: string;
  title: string;
  updated_at: string;
  is_pinned?: boolean;
  persona?: string;
}

interface ChatState {
  threads: Thread[];
  activeThreadId: string | null;
  messages: Record<string, Message[]>;
  streamingThreadIds: Set<string>;
  hasHydrated: boolean;
  createThread: (title: string, id: string, persona?: string) => void;
  selectThread: (id: string | null) => void;
  deleteThread: (id: string) => void;
  renameThread: (id: string, newTitle: string) => void;
  togglePinThread: (id: string) => void;
  setThreadPersona: (threadId: string, persona: string) => void;
  addMessage: (threadId: string, message: Message) => void;
  appendToken: (threadId: string, token: string) => void;
  removeLastEmptyAssistant: (threadId: string) => void;
  setThreads: (threads: Thread[]) => void;
  setHistory: (threadId: string, history: Message[]) => void;
  setStreamingThread: (threadId: string, isStreaming: boolean) => void;
  isThreadStreaming: (threadId: string) => boolean;
  clearStore: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  branchThread: (parentThreadId: string, uptoMessageId: string, newThreadId: string, title: string) => Promise<void>;
  truncateThreadHistory: (threadId: string, uptoMessageId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,
      messages: {},
      streamingThreadIds: new Set(),
      hasHydrated: false,
      createThread: (title, id, persona = 'personal assistant') => {
        const now = new Date().toISOString();
        const newThread: Thread = { id, title, persona, updated_at: now, is_pinned: false };
        set((state) => ({
          threads: [newThread, ...state.threads],
          activeThreadId: id,
          messages: { ...state.messages, [id]: [] }
        }));
        saveThread(newThread).catch(() => {});
      },
      selectThread: (id) => set({ activeThreadId: id }),
      deleteThread: (id) => {
        const config = useConfigStore.getState();
        if (!config.isLocalMode && config.apiUrl && config.apiKey) {
          const formattedUrl = normalizeUrl(config.apiUrl);
          fetch(`${formattedUrl}/chat/threads/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${config.apiKey.trim()}`,
            },
          }).then((res) => {
            if (!res.ok) {
              console.error(`[deleteThread] Failed to delete on backend, status: ${res.status}`);
            }
          }).catch((err) => console.error('[deleteThread] Failed to delete on backend:', err));
        }

        set((state) => {
          const nextThreads = state.threads.filter((t) => t.id !== id);
          const nextActive = state.activeThreadId === id
            ? (nextThreads[0]?.id || null)
            : state.activeThreadId;
          const nextMessages = { ...state.messages };
          delete nextMessages[id];
          return { threads: nextThreads, activeThreadId: nextActive, messages: nextMessages };
        });
        deleteThreadLocal(id).catch(() => {});
      },
  addMessage: (threadId, message) => {
    const now = new Date().toISOString();
    set((state) => {
      const current = state.messages[threadId] || [];
      const threadIndex = state.threads.findIndex(t => t.id === threadId);
      let updatedThreads = [...state.threads];
      if (threadIndex !== -1) {
        const updatedThread = {
          ...updatedThreads[threadIndex],
          updated_at: now
        };
        updatedThreads.splice(threadIndex, 1);
        updatedThreads = [updatedThread, ...updatedThreads];
      }
      return {
        messages: { ...state.messages, [threadId]: [...current, message] },
        threads: updatedThreads
      };
    });
    saveMessage(threadId, message).catch(() => {});
  },
      appendToken: (threadId, token) => {
        set((state) => {
          const current = state.messages[threadId] || [];
          if (current.length === 0) return {};
          const last = current[current.length - 1];
          if (last.role !== 'assistant') return {};
          
          const updatedLast = { ...last, content: last.content + token };
          return {
            messages: {
              ...state.messages,
              [threadId]: [...current.slice(0, -1), updatedLast]
            }
          };
        });
        scheduleMessagePersist(threadId);
      },
  removeLastEmptyAssistant: (threadId) =>
    set((state) => {
      const current = state.messages[threadId] || [];
      if (current.length === 0) return {};
      const last = current[current.length - 1];
      if (last.role !== 'assistant' || (last.content || '').trim() !== '') return {};
      deleteMessageLocal(last.id).catch(() => {});
      return { messages: { ...state.messages, [threadId]: current.slice(0, -1) } };
    }),
    renameThread: async (id, newTitle) => {
      const config = useConfigStore.getState();
      if (!config.isLocalMode && config.apiUrl && config.apiKey) {
        const formattedUrl = normalizeUrl(config.apiUrl);
        try {
          let res = await fetch(`${formattedUrl}/chat/threads/${id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${config.apiKey.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: newTitle }),
          });

          if (res.status === 405 || res.status === 404) {
            res = await fetch(`${formattedUrl}/chat/threads/${id}/rename`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ title: newTitle }),
            });
          }

          if (res.status === 405 || res.status === 404) {
            res = await fetch(`${formattedUrl}/chat/threads/${id}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${config.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ title: newTitle }),
            });
          }

          if (res.status === 405 || res.status === 404) {
            res = await fetch(`${formattedUrl}/chat/threads/rename`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ thread_id: id, id, title: newTitle }),
            });
          }

          if (!res.ok && res.status !== 404 && res.status !== 405) {
            console.warn(`[renameThread] Backend rename returned status: ${res.status}`);
          }
        } catch (err) {
          console.warn('[renameThread] Failed rename backend:', err);
        }
      }
    set((state) => ({
          threads: state.threads.map((t) => t.id === id ? { ...t, title: newTitle } : t)
        }));
      const renamed = useChatStore.getState().threads.find((t) => t.id === id);
      if (renamed) saveThread(renamed).catch(() => {});
      },
      togglePinThread: async (id) => {
        const config = useConfigStore.getState();
        if (!config.isLocalMode && config.apiUrl && config.apiKey) {
          const formattedUrl = normalizeUrl(config.apiUrl);
          const thread = useChatStore.getState().threads.find((t) => t.id === id);
          if (thread) {
            const nextPinnedStatus = !thread.is_pinned;
            try {
              const res = await fetch(`${formattedUrl}/chat/threads/${id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${config.apiKey.trim()}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ is_pinned: nextPinnedStatus }),
              });
              if (!res.ok) {
                console.warn(`[togglePinThread] Backend pin returned status: ${res.status}`);
              }
            } catch (err) {
              console.warn('[togglePinThread] Failed pin backend:', err);
            }
          }
        }
        set((state) => ({
          threads: state.threads.map((t) => t.id === id ? { ...t, is_pinned: !t.is_pinned } : t)
        }));
        const pinned = useChatStore.getState().threads.find((t) => t.id === id);
        if (pinned) saveThread(pinned).catch(() => {});
      },
      setThreadPersona: (threadId, persona) => {
        set((state) => ({
          threads: state.threads.map((t) => t.id === threadId ? { ...t, persona } : t)
        }));
        const updated = useChatStore.getState().threads.find((t) => t.id === threadId);
        if (updated) saveThread(updated).catch(() => {});
      },
      setThreads: (threads) => {
        set({ threads });
        saveThreads(threads).catch(() => {});
      },
      setHistory: (threadId, history) => {
        set((state) => ({
          messages: { ...state.messages, [threadId]: history }
        }));
        saveMessages(threadId, history).catch(() => {});
      },
      setStreamingThread: (threadId, isStreaming) => set((state) => {
        const next = new Set(state.streamingThreadIds);
        if (isStreaming) {
          next.add(threadId);
        } else {
          next.delete(threadId);
        }
        return { streamingThreadIds: next };
      }),
      isThreadStreaming: (threadId) => get().streamingThreadIds.has(threadId),
      clearStore: () => {
        set({ threads: [], activeThreadId: null, messages: {}, streamingThreadIds: new Set() });
        clearChatLocal().catch(() => {});
      },
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      branchThread: async (parentThreadId, uptoMessageId, newThreadId, title) => {
        const config = useConfigStore.getState();
        if (!config.isLocalMode && config.apiUrl && config.apiKey) {
          const formattedUrl = normalizeUrl(config.apiUrl);
          try {
            const res = await fetch(`${formattedUrl}/chat/threads/branch`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                parent_thread_id: parentThreadId,
                new_thread_id: newThreadId,
                upto_message_id: uptoMessageId,
                title: title,
              }),
            });
            if (!res.ok) {
              console.error(`[branchThread] Backend branch returned status: ${res.status}`);
            }
          } catch (err) {
            console.error('[branchThread] Failed to branch on backend:', err);
          }
        }

        set((state) => {
          const parentMessages = state.messages[parentThreadId] || [];
          const index = parentMessages.findIndex((m) => m.id === uptoMessageId);
          const branchedMessages = index !== -1 ? parentMessages.slice(0, index + 1) : [...parentMessages];
          
          const newThread = {
            id: newThreadId,
            title,
            updated_at: new Date().toISOString(),
          };

          return {
            threads: [newThread, ...state.threads],
            activeThreadId: newThreadId,
            messages: {
              ...state.messages,
              [newThreadId]: branchedMessages,
            },
          };
        });

        const branched = useChatStore.getState().messages[newThreadId] || [];
        saveThread({ id: newThreadId, title, updated_at: new Date().toISOString(), is_pinned: false }).catch(() => {});
        saveMessages(newThreadId, branched).catch(() => {});
      },

      truncateThreadHistory: async (threadId, uptoMessageId) => {
        const config = useConfigStore.getState();
        if (!config.isLocalMode && config.apiUrl && config.apiKey) {
          const formattedUrl = normalizeUrl(config.apiUrl);
          try {
            const res = await fetch(`${formattedUrl}/chat/threads/${threadId}/truncate`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                upto_message_id: uptoMessageId,
              }),
            });
            if (!res.ok) {
              console.error(`[truncateThreadHistory] Backend truncate returned status: ${res.status}`);
            }
          } catch (err) {
            console.error('[truncateThreadHistory] Failed to truncate on backend:', err);
          }
        }

        set((state) => {
          const current = state.messages[threadId] || [];
          const index = current.findIndex((m) => m.id === uptoMessageId);
          const truncatedMessages = index !== -1 ? current.slice(0, index) : [...current];

          return {
            messages: {
              ...state.messages,
              [threadId]: truncatedMessages,
            },
          };
        });

        const truncated = useChatStore.getState().messages[threadId] || [];
        replaceThreadMessages(threadId, truncated).catch(() => {});
      },
    }),
    {
      name: 'vela-chat-storage',
      storage: createJSONStorage(() => guardedAsyncStorage),
      partialize: (state) => ({
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        messages: state.messages,
      }),
      onRehydrateStorage: (state) => () => {
        // Ensure migrations run before reading from SQLite, then hydrate the
        // store from the local database (source of truth) so the UI can render
        // history without a backend. If SQLite is unavailable/empty, fall back
        // to the AsyncStorage cache (already merged by the persist middleware).
        (async () => {
          try {
            await initializeDatabase().catch(() => {});
            await hydrateChatFromLocalDb();
          } catch (error) {
            console.error('[useChatStore] Local hydration failed:', error);
          } finally {
            state?.setHasHydrated(true);
          }
        })();
      },
    }
  )
);
