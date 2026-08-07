import { db } from '../db/client';
import { operationLog, threads, messages } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function syncDatabase(apiUrl: string, apiKey: string): Promise<void> {
  if (!db) {
    console.warn('[Sync] Database client not available. Skipping sync.');
    return;
  }

  // 1. Fetch pending sync operations from operation log
  const pendingOps = await db.select().from(operationLog);

  if (pendingOps.length > 0) {
    const mappedOps = pendingOps.map(op => ({
      id: op.id,
      type: op.type,
      conversation_id: op.conversation_id,
      payload: JSON.parse(op.payload),
    }));

    const pushResponse = await fetch(`${apiUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ operations: mappedOps }),
    });

    if (!pushResponse.ok) {
      throw new Error(`Sync push failed with status ${pushResponse.status}`);
    }

    const pushData = await pushResponse.json();
    const accepted: string[] = pushData.accepted || [];

    if (accepted.length > 0) {
      await db.delete(operationLog).where(inArray(operationLog.id, accepted));
    }
  }

  // 2. Pull remote changes from backend
  let currentCursor = await AsyncStorage.getItem('last_sync_cursor');
  let hasMore = true;

  while (hasMore) {
    let url = `${apiUrl}/api/sync/pull`;
    if (currentCursor) {
      url += `?cursor=${encodeURIComponent(currentCursor)}`;
    }

    const pullResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!pullResponse.ok) {
      throw new Error(`Sync pull failed with status ${pullResponse.status}`);
    }

    const pullData = await pullResponse.json();
    const operations = pullData.operations || [];
    currentCursor = pullData.cursor || currentCursor;
    hasMore = pullData.has_more || false;

    for (const op of operations) {
      if (op.type === 'message') {
        const threadId = op.conversation_id;
        const msgPayload = op.payload;

        // Check if thread exists in local SQLite threads
        const existingThreads = await db.select().from(threads).where(eq(threads.id, threadId));
        if (existingThreads.length === 0) {
          // Create default thread entry first
          await db.insert(threads).values({
            id: threadId,
            title: 'Synced Conversation',
            persona: 'personal assistant',
            updated_at: new Date().toISOString(),
            is_pinned: false,
          });
        }

        // Insert or update message in local SQLite messages
        const existingMessages = await db.select().from(messages).where(eq(messages.id, op.id));
        if (existingMessages.length === 0) {
          await db.insert(messages).values({
            id: op.id,
            conversation_id: threadId,
            role: msgPayload.role,
            content: msgPayload.content,
            provider: msgPayload.provider || 'remote',
            created_at: Number(msgPayload.created_at) || Date.now(),
          });
        } else {
          await db.update(messages)
            .set({
              content: msgPayload.content,
              role: msgPayload.role,
              provider: msgPayload.provider || 'remote',
              created_at: Number(msgPayload.created_at) || Date.now(),
            })
            .where(eq(messages.id, op.id));
        }
      }
    }

    if (currentCursor) {
      await AsyncStorage.setItem('last_sync_cursor', currentCursor);
    }
  }
}
