import { db } from '../db/client';
import { operationLog, threads, messages } from '../db/schema';
import { eq, inArray, isNull, or } from 'drizzle-orm';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markMessageSynced, hydrateChatFromLocalDb } from '../db/chatRepository';

export interface StandaloneSyncStatus {
  isSyncing: boolean;
  message: string | null;
  pushedCount: number;
}

let syncStatus: StandaloneSyncStatus = {
  isSyncing: false,
  message: null,
  pushedCount: 0,
};

const listeners = new Set<(status: StandaloneSyncStatus) => void>();

export function getStandaloneSyncStatus(): StandaloneSyncStatus {
  return { ...syncStatus };
}

export function subscribeToStandaloneSync(
  listener: (status: StandaloneSyncStatus) => void
): () => void {
  listeners.add(listener);
  listener(getStandaloneSyncStatus());
  return () => {
    listeners.delete(listener);
  };
}

function updateSyncStatus(patch: Partial<StandaloneSyncStatus>) {
  syncStatus = { ...syncStatus, ...patch };
  listeners.forEach((cb) => cb(getStandaloneSyncStatus()));
}

const cleanUrl = (rawUrl: string): string => {
  let formatted = (rawUrl || '').trim();
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted;
  }
  return formatted.replace(/\/+$/, '');
};

export async function getUnsyncedLocalCount(): Promise<number> {
  if (!db) return 0;
  try {
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(or(isNull(messages.server_id), eq(messages.pending, true)));
    return rows.length;
  } catch (e) {
    console.warn('[getUnsyncedLocalCount] Error:', e);
    return 0;
  }
}

export async function syncStandaloneDataToBackend(
  apiUrl: string,
  apiKey: string
): Promise<{ pushedCount: number; success: boolean }> {
  if (!db) {
    return { pushedCount: 0, success: false };
  }

  const normalizedApiUrl = cleanUrl(apiUrl);

  updateSyncStatus({
    isSyncing: true,
    message: 'Preparing standalone messages for upload...',
    pushedCount: 0,
  });

  try {
    const unsynced = await db
      .select()
      .from(messages)
      .where(or(isNull(messages.server_id), eq(messages.pending, true)));

    if (unsynced.length === 0) {
      // Nothing to push, just pull remote changes
      updateSyncStatus({ message: 'Synchronizing remote conversations...' });
      await syncDatabase(normalizedApiUrl, apiKey);
      await hydrateChatFromLocalDb();
      updateSyncStatus({
        isSyncing: false,
        message: 'All conversations up to date.',
        pushedCount: 0,
      });
      return { pushedCount: 0, success: true };
    }

    updateSyncStatus({
      message: `Uploading ${unsynced.length} local messages...`,
    });

    let totalPushed = 0;
    const CHUNK_SIZE = 50;

    for (let i = 0; i < unsynced.length; i += CHUNK_SIZE) {
      const chunk = unsynced.slice(i, i + CHUNK_SIZE);
      const operations = chunk.map((m: (typeof unsynced)[number]) => ({
        id: m.id,
        type: 'message',
        conversation_id: m.conversation_id,
        payload: {
          role: m.role,
          content: m.content,
          provider: 'android_client',
          created_at: m.created_at,
          origin: 'standalone',
        },
      }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`${normalizedApiUrl}/api/sync/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ operations }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Sync push failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      const accepted: string[] = data.accepted || [];

      if (accepted.length > 0) {
        await Promise.all(accepted.map((opId) => markMessageSynced(opId, opId)));
        await db.delete(operationLog).where(inArray(operationLog.id, accepted));
      }
      totalPushed += accepted.length;
    }

    // Now pull remote changes and hydrate store
    updateSyncStatus({
      message: `Pushed ${totalPushed} messages. Merging remote updates...`,
      pushedCount: totalPushed,
    });

    await syncDatabase(normalizedApiUrl, apiKey);
    await hydrateChatFromLocalDb();

    updateSyncStatus({
      isSyncing: false,
      message: `Synced ${totalPushed} messages successfully.`,
      pushedCount: totalPushed,
    });

    return { pushedCount: totalPushed, success: true };
  } catch (err: any) {
    console.error('[syncStandaloneDataToBackend] Error:', err);
    updateSyncStatus({
      isSyncing: false,
      message: `Sync error: ${err?.message || 'Upload failed'}`,
    });
    return { pushedCount: 0, success: false };
  }
}

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
    let decoded: unknown = null;
    try {
      decoded = JSON.parse(op.payload);
      // Coderabbit #261: JSON.parse('null') succeeds but yields null, which
      // would enter mappedOps and be POSTed to /api/sync/push whose payload
      // contract requires a dictionary. Quarantine non-dictionary payloads.
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        throw new Error('decoded payload is not a dictionary');
      }
      mappedOps.push({
        id: op.id,
        type: op.type,
        conversation_id: op.conversation_id,
        payload: decoded,
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

        if (
          !msgPayload ||
          typeof msgPayload !== 'object' ||
          !('role' in msgPayload) ||
          !('content' in msgPayload)
        ) {
          console.warn('[Sync] Skipping corrupt pull operation:', op.id);
          continue;
        }

        // Check if thread exists in local SQLite threads
        const existingThreads = await db.select().from(threads).where(eq(threads.id, threadId));
        if (existingThreads.length === 0) {
          // Create default thread entry first
          await db.insert(threads).values({
            id: threadId,
            title: 'Synced Conversation',
            agent: 'personal assistant',
            updated_at: new Date().toISOString(),
            is_pinned: false,
          });
        }

        // Insert or update message in local SQLite messages. Messages pulled
        // from the backend are already acknowledged, so pending=false and
        // server_id=op.id.
        // Idempotent union deduplication: match on local id OR server_id.
        const existingMessages = await db
          .select()
          .from(messages)
          .where(or(eq(messages.id, op.id), eq(messages.server_id, op.id)));
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
            .where(or(eq(messages.id, op.id), eq(messages.server_id, op.id)));
        }
      }
    }

    if (currentCursor) {
      await AsyncStorage.setItem('last_sync_cursor', currentCursor);
    }
  }
}
