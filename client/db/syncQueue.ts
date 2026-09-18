import { db } from './client';
import { operationLog, OperationLogEntity } from './schema';
import { eq, inArray } from 'drizzle-orm';
import { generateUlid } from '../utils/syncIds';

export interface DeviceStepSyncEvent {
  id: string;
  role: string;
  tool_name?: string;
  target?: string;
  value?: string;
  status: string;
  observation?: string;
  timestamp: number;
}

export interface DeviceStepsSyncPayload {
  conversation_id: string;
  client_sync_id: string;
  events: DeviceStepSyncEvent[];
}

export interface SyncDrainResult {
  syncedCount: number;
  failedCount: number;
}

/**
 * Drains pending device steps from SQLite operationLog and synchronizes
 * them to the FastAPI backend POST /api/sync/device-steps endpoint.
 */
export async function drainDeviceStepSyncQueue(
  apiUrl: string,
  apiKey: string,
  batchSize: number = 25
): Promise<SyncDrainResult> {
  if (!db) {
    return { syncedCount: 0, failedCount: 0 };
  }

  let pendingOps: OperationLogEntity[] = [];
  try {
    pendingOps = await db
      .select()
      .from(operationLog)
      .where(eq(operationLog.type, 'device_step'))
      .limit(batchSize);
  } catch (err) {
    console.warn('[syncQueue] Error reading device steps from operationLog:', err);
    return { syncedCount: 0, failedCount: 0 };
  }

  if (!pendingOps || pendingOps.length === 0) {
    return { syncedCount: 0, failedCount: 0 };
  }

  // Group operations by conversation_id
  const grouped = new Map<string, OperationLogEntity[]>();
  for (const op of pendingOps) {
    const list = grouped.get(op.conversation_id) || [];
    list.push(op);
    grouped.set(op.conversation_id, list);
  }

  let totalSynced = 0;
  let totalFailed = 0;

  for (const [convId, ops] of grouped.entries()) {
    const events: DeviceStepSyncEvent[] = [];
    const postedIds: string[] = [];

    for (const op of ops) {
      let data: any = null;
      try {
        data = JSON.parse(op.payload);
        // Coderabbit #261: JSON.parse('null') succeeds but yields null, and
        // data.toolName below would then throw outside quarantine and abort
        // the whole drain. Treat any non-dictionary payload as corrupt.
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new Error('decoded payload is not a dictionary');
        }
      } catch {
        // T5 (#253): quarantine the poison row so one corrupt payload cannot
        // wedge the queue forever (each retry would rebuild the same junk
        // event). Delete + count as failed, never abort the batch.
        console.warn('[syncQueue] Quarantining device-step op with corrupt payload:', op.id);
        try {
          await db.delete(operationLog).where(eq(operationLog.id, op.id));
        } catch (deleteErr) {
          console.warn('[syncQueue] Failed to quarantine corrupt op:', op.id, deleteErr);
        }
        totalFailed += 1;
        continue;
      }

      // Only posted ids participate in the accepted/rejected accounting below;
      // quarantined rows are already counted as failed above.
      postedIds.push(op.id);

      events.push({
        id: op.id,
        role: 'assistant',
        tool_name: data.toolName,
        target: data.target,
        value: data.value,
        status: data.status || 'executed',
        observation: data.observation,
        timestamp: data.timestamp || op.created_at,
      });
    }

    if (events.length === 0) {
      // Every op in this group was quarantined; nothing to POST.
      continue;
    }

    const payload: DeviceStepsSyncPayload = {
      conversation_id: convId,
      client_sync_id: generateUlid(),
      events,
    };

    try {
      const response = await fetch(`${apiUrl}/api/sync/device-steps`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Sync request failed with status ${response.status}`);
      }

      const resData = await response.json();
      const acceptedIds: string[] = resData.accepted || [];

      if (acceptedIds.length > 0) {
        await db.delete(operationLog).where(inArray(operationLog.id, acceptedIds));
        totalSynced += acceptedIds.length;
      }

      const rejectedCount = postedIds.length - acceptedIds.length;
      if (rejectedCount > 0) {
        totalFailed += rejectedCount;
      }
    } catch (err) {
      console.warn(`[syncQueue] Failed to sync device steps for conversation ${convId}:`, err);
      totalFailed += postedIds.length;
    }
  }

  return {
    syncedCount: totalSynced,
    failedCount: totalFailed,
  };
}

/**
 * Background worker managing periodic sync drain with network retry.
 */
export class DeviceStepSyncWorker {
  private timer: any = null;
  private isRunning: boolean = false;

  constructor(
    private getCredentials: () => Promise<{ apiUrl: string; apiKey: string } | null>,
    private intervalMs: number = 15000
  ) {}

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext(1000); // initial immediate drain
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delay: number) {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        const creds = await this.getCredentials();
        if (creds && creds.apiUrl && creds.apiKey) {
          await drainDeviceStepSyncQueue(creds.apiUrl, creds.apiKey);
        }
      } catch (err) {
        console.warn('[DeviceStepSyncWorker] Error in sync iteration:', err);
      } finally {
        this.scheduleNext(this.intervalMs);
      }
    }, delay);
  }
}
