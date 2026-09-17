import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import db from '../db/client';
import { tasks, taskRuns } from '../db/schema';
import { eq, and, lte, isNull, or } from 'drizzle-orm';
import { useConfigStore } from '../store/useConfigStore';
import {
  isCheckinSchedulerTask,
  gateCheckinTask,
  presentCheckinNotification,
  NUDGE_TASK_ID,
} from './checkinScheduler';

export const VELA_BACKGROUND_TASK = 'vela-background-task';

async function advanceTaskSchedule(taskId: string, recurrenceRule: string, startedAt: number): Promise<void> {
  if (!db) return;
  const nextRunTime = calculateNextRun(recurrenceRule, startedAt);
  await db.update(tasks)
    .set({
      last_run: startedAt,
      next_run: nextRunTime,
    })
    .where(eq(tasks.id, taskId));
}

export function calculateNextRun(recurrenceRule: string, lastRun: number): number {
  const base = lastRun || Date.now();
  if (recurrenceRule === '15m') {
    return base + 15 * 60 * 1000;
  } else if (recurrenceRule === '1h') {
    return base + 60 * 60 * 1000;
  } else if (recurrenceRule === '12h') {
    return base + 12 * 60 * 60 * 1000;
  } else if (recurrenceRule === '24h') {
    return base + 24 * 60 * 60 * 1000;
  } else if (recurrenceRule === 'weekly') {
    return base + 7 * 24 * 60 * 60 * 1000;
  }
  return base + 24 * 60 * 60 * 1000;
}

const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

TaskManager.defineTask(VELA_BACKGROUND_TASK, async (body: any) => {
  const { error } = body || {};
  if (error) {
    console.error(`Background Task ID error: ${error.message}`);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }

  try {
    if (!db) {
      console.warn('[Background Task] DB client not available.');
      return BackgroundTask.BackgroundTaskResult.Failed;
    }

    const { apiUrl, apiKey } = useConfigStore.getState();
    if (!apiUrl || !apiKey) {
      console.warn('[Background Task] API credentials not set.');
      return BackgroundTask.BackgroundTaskResult.Failed;
    }

    const now = Date.now();
    const activeTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'active'), or(isNull(tasks.next_run), lte(tasks.next_run, now))));

    if (activeTasks.length === 0) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    for (const task of activeTasks) {
      const runId = generateId();
      const startedAt = Date.now();

      // Check-in scheduler rows are gated: suppressed rows advance without
      // firing so other due tasks still get their turn this tick.
      if (isCheckinSchedulerTask(task)) {
        const gate = await gateCheckinTask(task.id);
        if (!gate.fire) {
          await db.insert(taskRuns).values({
            id: runId,
            task_id: task.id,
            status: 'completed',
            started_at: startedAt,
            completed_at: Date.now(),
            output: gate.reason,
          });
          await advanceTaskSchedule(task.id, task.recurrence_rule, startedAt);
          continue;
        }
      }

      await db.insert(taskRuns).values({
        id: runId,
        task_id: task.id,
        status: 'running',
        started_at: startedAt,
      });

      try {
        const response = await fetch(`${apiUrl}/api/tasks/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            task_id: task.id,
            title: task.title,
            prompt: task.task_prompt,
            agent: task.linked_agent || 'personal assistant',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        if (data.status === 'success') {
          await db.update(taskRuns)
            .set({
              status: 'completed',
              completed_at: Date.now(),
              output: data.output,
            })
            .where(eq(taskRuns.id, runId));
          if (isCheckinSchedulerTask(task)) {
            if (task.id === NUDGE_TASK_ID) {
              await presentCheckinNotification(
                'vela-checkin-nudge-note',
                'Gentle nudge 🌱',
                `${data.output || 'No check-in yesterday — how are you today?'} Reply 'skip' to dismiss.`
              );
            } else {
              await presentCheckinNotification(
                'vela-checkin-weekly-note',
                'Weekly reflection 📊',
                data.output || 'Your week in review is ready — open chat to see it.'
              );
            }
          }
        } else {
          throw new Error(data.output || 'Unknown backend error');
        }
      } catch (err: any) {
        await db.update(taskRuns)
          .set({
            status: 'failed',
            completed_at: Date.now(),
            output: err.name === 'TypeError' ? 'Network unavailable' : (err.message || 'Execution failed'),
          })
          .where(eq(taskRuns.id, runId));
      }

      await advanceTaskSchedule(task.id, task.recurrence_rule, startedAt);
      break;
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.error('[Background Task] Execution error:', err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerVelaBackgroundTask() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(VELA_BACKGROUND_TASK);
    if (!isRegistered) {
      await BackgroundTask.registerTaskAsync(VELA_BACKGROUND_TASK, {
        minimumInterval: 15,
      });
      console.log('[Background Task] Registered successfully.');
    }
  } catch (err) {
    console.error('[Background Task] Register failed:', err);
  }
}

export async function unregisterVelaBackgroundTask() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(VELA_BACKGROUND_TASK);
    if (isRegistered) {
      await BackgroundTask.unregisterTaskAsync(VELA_BACKGROUND_TASK);
      console.log('[Background Task] Unregistered successfully.');
    }
  } catch (err) {
    console.error('[Background Task] Unregister failed:', err);
  }
}