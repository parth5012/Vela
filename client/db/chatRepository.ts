import { db } from './client';
import { threads, messages } from './schema';
import { eq, asc, desc } from 'drizzle-orm';
import { useChatStore, Thread, Message } from '../store/useChatStore';

/**
 * Local-first chat repository.
 *
 * SQLite is the source of truth for chat threads/messages on the device.
 * Every write goes through the zustand store (see useChatStore), which calls
 * into this module so rows are persisted locally. At launch the store hydrates
 * from here before any backend sync, so history renders without a connection.
 *
 * All functions are safe to call when the database is unavailable
 * (test / non-native environments): they no-op or return [].
 */

export function isLocalDbAvailable(): boolean {
  return !!db;
}

function toThreadRow(thread: Thread) {
  return {
    id: thread.id,
    title: thread.title,
    persona: thread.persona || 'personal assistant',
    updated_at: thread.updated_at,
    is_pinned: thread.is_pinned ?? false,
  };
}

function toMessageRow(conversationId: string, message: Message) {
  return {
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    provider: 'local',
    created_at: message.created_at ? Date.parse(message.created_at) || Date.now() : Date.now(),
    pending: false,
    server_id: null as string | null,
  };
}

function fromThreadRow(row: any): Thread {
  return {
    id: row.id,
    title: row.title,
    persona: row.persona,
    updated_at: row.updated_at,
    is_pinned: !!row.is_pinned,
  };
}

function fromMessageRow(row: any): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at ? new Date(Number(row.created_at)).toISOString() : undefined,
  };
}

export async function saveThread(thread: Thread): Promise<void> {
  if (!db) return;
  const row = toThreadRow(thread);
  await db
    .insert(threads)
    .values(row)
    .onConflictDoUpdate({
      target: threads.id,
      set: {
        title: row.title,
        persona: row.persona,
        updated_at: row.updated_at,
        is_pinned: row.is_pinned,
      },
    });
}

export async function saveThreads(threadList: Thread[]): Promise<void> {
  if (!db) return;
  for (const thread of threadList) {
    await saveThread(thread);
  }
}

export async function deleteThreadLocal(threadId: string): Promise<void> {
  if (!db) return;
  await db.delete(threads).where(eq(threads.id, threadId));
}

export async function deleteMessageLocal(messageId: string): Promise<void> {
  if (!db) return;
  await db.delete(messages).where(eq(messages.id, messageId));
}

export async function clearChatLocal(): Promise<void> {
  if (!db) return;
  await db.delete(messages);
  await db.delete(threads);
}

export async function saveMessage(conversationId: string, message: Message): Promise<void> {
  if (!db) return;
  const row = toMessageRow(conversationId, message);
  await db
    .insert(messages)
    .values(row)
    .onConflictDoUpdate({
      target: messages.id,
      set: {
        content: row.content,
        role: row.role,
        created_at: row.created_at,
      },
    });
}

export async function saveMessages(conversationId: string, messageList: Message[]): Promise<void> {
  if (!db) return;
  for (const message of messageList) {
    await saveMessage(conversationId, message);
  }
}

/**
 * Replaces the local message set for a conversation with the given list.
 * Used by branch/truncate so stale rows do not survive history edits.
 */
export async function replaceThreadMessages(conversationId: string, messageList: Message[]): Promise<void> {
  if (!db) return;
  await db.delete(messages).where(eq(messages.conversation_id, conversationId));
  await saveMessages(conversationId, messageList);
}

export async function loadThreads(): Promise<Thread[]> {
  if (!db) return [];
  // Store keeps threads newest-first (createThread prepends, addMessage moves
  // to front); mirror that ordering so hydration renders the same list.
  const rows = await db.select().from(threads).orderBy(desc(threads.updated_at));
  return rows.map(fromThreadRow);
}

export async function loadMessages(conversationId: string): Promise<Message[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(asc(messages.created_at));
  return rows.map(fromMessageRow);
}

/**
 * Hydrates the chat store from SQLite (source of truth) at launch.
 *
 * Runs after AsyncStorage rehydration. If SQLite has threads, it wins over
 * the AsyncStorage cache. If SQLite is empty (first run after migration),
 * the existing store state is left untouched so we never wipe data.
 */
export async function hydrateChatFromLocalDb(): Promise<void> {
  if (!db) return;
  try {
    const threadList = await loadThreads();
    if (threadList.length === 0) return;

    useChatStore.getState().setThreads(threadList);

    const messagesByThread: Record<string, Message[]> = {};
    for (const thread of threadList) {
      const history = await loadMessages(thread.id);
      if (history.length > 0) {
        messagesByThread[thread.id] = history;
      }
    }

    const state = useChatStore.getState();
    for (const [threadId, history] of Object.entries(messagesByThread)) {
      state.setHistory(threadId, history);
    }

    if (!state.activeThreadId && threadList.length > 0) {
      state.selectThread(threadList[0].id);
    }
  } catch (error) {
    console.error('[ChatRepository] Failed to hydrate from local db:', error);
  }
}
