import * as Notifications from 'expo-notifications';
import { eq } from 'drizzle-orm';
import db from '../db/client';
import { tasks, checkIns } from '../db/schema';
import { CHECKIN_CHANNEL_ID } from './checkIn';

/**
 * Scheduled check-in rows live in the existing `tasks` table — no new
 * scheduler machinery (wayfinder #119). `tasks.description` carries the
 * kind discriminator so the Tasks screen can filter these rows out.
 */
export const CHECKIN_TASK_KIND = 'vela:checkin';
export const NUDGE_TASK_ID = 'vela-checkin-nudge';
export const WEEKLY_TASK_ID = 'vela-checkin-weekly';

export const NUDGE_PROMPT =
  'Yesterday has no check-in entry. Send one soft, guilt-free morning nudge inviting ' +
  "today's check-in (mood 1-5, energy, one win, one thing being carried). " +
  'One short message, warm and zero-pressure. If the user says skip, stop immediately. Never guilt.';

export const WEEKLY_PROMPT =
  'Look back over the last 7 days of check-in entries and name honest, evidence-based ' +
  'patterns (mood/energy trend, recurring wins, recurring weights) with a kind, actionable ' +
  'framing. Keep it short enough for a notification body. Base every claim on entries; ' +
  'never invent days with no data.';

export interface SchedulerGate {
  fire: boolean;
  reason: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function yesterdayDateString(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return localDateString(d);
}

export function isCheckinSchedulerTask(task: { description?: string | null }): boolean {
  return task?.description === CHECKIN_TASK_KIND;
}

/** User-created tasks stay visible; scheduler rows are filtered out of the Tasks screen. */
export function isUserVisibleTask(task: { description?: string | null }): boolean {
  return !isCheckinSchedulerTask(task);
}

function nudgeRow(now: number) {
  return {
    id: NUDGE_TASK_ID,
    title: 'Missed check-in nudge',
    description: CHECKIN_TASK_KIND,
    status: 'active' as const,
    recurrence_rule: '24h',
    linked_agent: 'check-in',
    task_prompt: NUDGE_PROMPT,
    last_run: null as number | null,
    next_run: null as number | null,
    created_at: now,
  };
}

function weeklyRow(now: number) {
  return {
    id: WEEKLY_TASK_ID,
    title: 'Weekly check-in reflection',
    description: CHECKIN_TASK_KIND,
    status: 'active' as const,
    recurrence_rule: 'weekly',
    linked_agent: 'analyst',
    task_prompt: WEEKLY_PROMPT,
    last_run: null as number | null,
    next_run: null as number | null,
    created_at: now,
  };
}

/** Idempotently seeds the nudge + weekly rows. Safe to call on every launch. */
export async function ensureCheckinSchedulerTasks(): Promise<void> {
  if (!db) return;
  const now = Date.now();
  for (const row of [nudgeRow(now), weeklyRow(now)]) {
    let existing: unknown[] = [];
    try {
      existing = await db.select().from(tasks).where(eq(tasks.id, row.id));
    } catch (e) {
      console.warn('[checkinScheduler] Failed to read scheduler rows', e);
      return;
    }
    if (existing.length === 0) {
      try {
        await db.insert(tasks).values(row);
      } catch (e) {
        console.warn('[checkinScheduler] Failed to seed scheduler row', row.id, e);
      }
    }
  }
}

export async function hasCheckinForDate(date: string): Promise<boolean> {
  if (!db) return false;
  try {
    const rows = await db.select().from(checkIns).where(eq(checkIns.date, date));
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function hasCheckinsSince(days: number, now: Date = new Date()): Promise<boolean> {
  if (!db) return false;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = localDateString(cutoff);
  try {
    const rows = await db.select().from(checkIns);
    return rows.some((r: { date: string }) => r.date >= cutoffStr);
  } catch {
    return false;
  }
}

/**
 * Decides whether a due scheduler row should actually fire.
 * - Nudge fires only when yesterday has no entry (1 max, suppressed otherwise).
 * - Weekly fires only when the week has at least one entry.
 */
export async function gateCheckinTask(taskId: string, now: Date = new Date()): Promise<SchedulerGate> {
  if (taskId === NUDGE_TASK_ID) {
    const missing = !(await hasCheckinForDate(yesterdayDateString(now)));
    return missing
      ? { fire: true, reason: 'yesterday has no entry' }
      : { fire: false, reason: 'suppressed: yesterday already has an entry' };
  }
  if (taskId === WEEKLY_TASK_ID) {
    const hasAny = await hasCheckinsSince(7, now);
    return hasAny
      ? { fire: true, reason: 'week has entries' }
      : { fire: false, reason: 'suppressed: week has zero entries' };
  }
  return { fire: true, reason: 'not a check-in scheduler row' };
}

/**
 * Presents a check-in notification immediately. Tapping it opens chat
 * (data type `checkin`) where the reply becomes the check-in — and the
 * CheckInSkill honors "skip", which is the one-tap skip path.
 */
export async function presentCheckinNotification(
  identifier: string,
  title: string,
  body: string
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title,
        body,
        data: { type: 'checkin' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        channelId: CHECKIN_CHANNEL_ID,
      },
    });
  } catch (e) {
    console.warn('[checkinScheduler] Failed to present check-in notification', e);
  }
}
