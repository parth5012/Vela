import { db } from './client';
import { checkIns } from './schema';
import { eq, desc } from 'drizzle-orm';

export interface CheckInInput {
  /** Local calendar day as YYYY-MM-DD. Same-day saves replace each other. */
  date: string;
  /** 1-5 */
  mood: number;
  /** 1-5 */
  energy: number;
  win?: string | null;
  carrying?: string | null;
  note?: string | null;
}

export interface CheckinFlushResult {
  syncedCount: number;
  failedCount: number;
}

/**
 * Local-first check-in repository.
 *
 * Rows are keyed `checkin-<YYYY-MM-DD>` so a second save on the same day
 * replaces the first (mirrors the backend unique (conversation_id, date)
 * upsert). Rows start with `synced = false` and are flushed to
 * POST /api/checkins when connectivity returns.
 *
 * All functions are safe to call when the database is unavailable
 * (test / non-native environments): writes throw only on invalid input,
 * reads return [].
 */

export function isCheckinDbAvailable(): boolean {
  return !!db;
}

export function checkinRowId(date: string): string {
  return `checkin-${date}`;
}

function assertValidScores(mood: number, energy: number): void {
  for (const [label, value] of [
    ['mood', mood],
    ['energy', energy],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new RangeError(`[checkinRepository] ${label} must be an integer 1-5, got ${value}`);
    }
  }
}

export async function saveCheckinLocal(input: CheckInInput) {
  assertValidScores(input.mood, input.energy);
  const row = {
    id: checkinRowId(input.date),
    date: input.date,
    mood: input.mood,
    energy: input.energy,
    win: input.win ?? null,
    carrying: input.carrying ?? null,
    note: input.note ?? null,
    synced: false,
    created_at: Date.now(),
  };
  if (!db) return row;
  await db
    .insert(checkIns)
    .values(row)
    .onConflictDoUpdate({
      target: checkIns.id,
      set: {
        mood: row.mood,
        energy: row.energy,
        win: row.win,
        carrying: row.carrying,
        note: row.note,
        synced: false,
        created_at: row.created_at,
      },
    });
  return row;
}

export async function loadCheckins(limit: number = 30) {
  if (!db) return [];
  return db.select().from(checkIns).orderBy(desc(checkIns.date)).limit(limit);
}

export async function loadUnsyncedCheckins() {
  if (!db) return [];
  return db.select().from(checkIns).where(eq(checkIns.synced, false));
}

export async function markCheckinSynced(id: string): Promise<void> {
  if (!db) return;
  await db.update(checkIns).set({ synced: true }).where(eq(checkIns.id, id));
}

function normalizeBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

/**
 * Flushes locally-queued (`synced = false`) check-ins to the backend.
 * Request-based: failures keep rows pending for the next trigger.
 */
export async function flushUnsyncedCheckins(
  apiUrl: string,
  apiKey: string,
  conversationId: string
): Promise<CheckinFlushResult> {
  if (!db || !apiUrl || !apiKey || !conversationId) {
    return { syncedCount: 0, failedCount: 0 };
  }
  const pending = await loadUnsyncedCheckins();
  if (pending.length === 0) {
    return { syncedCount: 0, failedCount: 0 };
  }
  const base = normalizeBaseUrl(apiUrl);
  let syncedCount = 0;
  let failedCount = 0;
  for (const row of pending) {
    try {
      const response = await fetch(`${base}/api/checkins`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          date: row.date,
          mood: row.mood,
          energy: row.energy,
          win: row.win,
          carrying: row.carrying,
          note: row.note,
        }),
      });
      if (!response.ok) {
        throw new Error(`Check-in sync failed with status ${response.status}`);
      }
      await markCheckinSynced(row.id);
      syncedCount += 1;
    } catch (err) {
      console.warn('[checkinRepository] Failed to flush check-in for', row.date, err);
      failedCount += 1;
    }
  }
  return { syncedCount, failedCount };
}
