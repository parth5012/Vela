import { db } from '../db/client';
import { operationLog, threads, messages } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markMessageSynced } from '../db/chatRepository';

export async function syncDatabase(apiUrl: string, apiKey: string): Promise<void> {
  if (!db) {
    console.warn('[Sync] Database client not available. Skipping sync.');
    return;
  }

  // 1. Fetch pending MESSAGE sync operations. Device steps share the same
  // operation_log table but drain exclusively via POST /api/sync/device-steps
  // (drainDeviceStepSyncQueue) — POSTing them to /api/sync/push only earns a
  // server rejection, so filter them out at the query (T5, issue #253).
  const pendingOps = await db
    .select()
    .from(operationLog)
    .where(eq(operationLog.type, 'message'));

  // Per-row parse with quarantine: one corrupt payload must never abort the
  // whole sync (T5, issue #253). Bad rows are deleted (dead-lettered) and
  // logged; the message row itself is left untouched.
  const mappedOps: {
    id: string;
    type: string;
    conversation_id: string;
    payload: unknown;
  }[] = [];
  for (const op of pendingOps) {
    try {
      mappedOps.push({
        id: op.id,
        type: op.type,
        conversation_id: op.conversation_id,
        payload: JSON.parse(op.payload),
      });
    } catch (err) {
      console.warn('[Sync] Quarantining operation with corrupt payload:', op.id, err);
      try {
        await db.delete(operationLog).where(eq(operationLog.id, op.id));
      } catch (deleteErr) {
        console.warn('[Sync] Failed to quarantine corrupt operation:', op.id, deleteErr);
      }
    }
  }

  // Defense-in-depth: even if the query filter above is ever bypassed
  // (mocked db, query-builder drift), never POST device_step ops to /push.
  const pushableOps = mappedOps.filter((op) => op.type === 'message');

  if (pushableOps.length > 0) {
    const pushResponse = await fetch(`${apiUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ operations: pushableOps }),
    });

    if (!pushResponse.ok) {
      throw new Error(`Sync push failed with status ${pushResponse.status}`);
    }

    const pushData = await pushResponse.json();
    const accepted: string[] = pushData.accepted || [];

    if (accepted.length > 0) {
      await db.delete(operationLog).where(inArray(operationLog.id, accepted));
      // Flip the local messages from pending to synced so the next offline
      // flush does not re-push them, and record the server id.
      for (const opId of accepted) {
        await markMessageSynced(opId, opId);
      }
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

        // Insert or update message in local SQLite messages. Messages pulled
        // from the backend are already acknowledged, so pending=false and
        // server_id=op.id.
        const existingMessages = await db.select().from(messages).where(eq(messages.id, op.id));
        if (existingMessages.length === 0) {
          await db.insert(messages).values({
            id: op.id,
            conversation_id: threadId,
            role: msgPayload.role,
            content: msgPayload.content,
            provider: msgPayload.provider || 'remote',
            created_at: Number(msgPayload.created_at) || Date.now(),
            pending: false,
            server_id: op.id,
          });
        } else {
          await db.update(messages)
            .set({
              content: msgPayload.content,
              role: msgPayload.role,
              provider: msgPayload.provider || 'remote',
              created_at: Number(msgPayload.created_at) || Date.now(),
              pending: false,
              server_id: op.id,
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
