import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { db } from '../db/client';
import {
  taskExecutions,
  taskStepExecutions,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import useForegroundTaskStore from '../store/useForegroundTaskStore';

export const VELA_FOREGROUND_TASK = 'vela-foreground-task';

export const FOREGROUND_NOTIFICATION_CHANNEL = 'vela-foreground-task';
export const FOREGROUND_NOTIFICATION_ID = 'vela-foreground-task-running';
export const APPROVAL_NOTIFICATION_ID = 'vela-approval-required';

async function presentNotification(identifier: string, content: any) {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content,
      trigger: null,
    });
  } catch (error) {
    console.warn('[ForegroundTask] Failed to present notification:', error);
  }
}

export async function cancelNotification(identifier: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch (error) {
    console.warn('[ForegroundTask] Failed to cancel notification:', error);
  }
}

export async function updateProgressNotification(
  executionId: string,
  stepIndex: number,
  stepCount: number,
  currentAction: string
) {
  await presentNotification(FOREGROUND_NOTIFICATION_ID, {
    title: `Vela Task Step ${stepIndex}/${stepCount}`,
    body: currentAction || 'Executing automation task...',
    data: { type: 'foreground_task', execution_id: executionId },
    sound: false,
    android: { channelId: FOREGROUND_NOTIFICATION_CHANNEL },
  });
}

export async function showApprovalNotification(
  executionId: string,
  action: string
) {
  await presentNotification(APPROVAL_NOTIFICATION_ID, {
    title: 'Vela needs your approval',
    body: action || 'A task requires your confirmation to continue.',
    data: { type: 'approval_needed', execution_id: executionId },
    android: {
      channelId: 'vela-approval',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
  });
}

TaskManager.defineTask(VELA_FOREGROUND_TASK, async (body: any) => {
  const error = body?.error;
  if (error) {
    console.error('[ForegroundTask] Task error:', error.message);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
  try {
    const store = useForegroundTaskStore.getState();
    if (!store.isRunning || !store.execution_id) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    if (!db) return BackgroundTask.BackgroundTaskResult.Failed;

    const execution = await db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.id, store.execution_id))
      .limit(1)
      .then((rows: any[]) => rows[0]);
    if (!execution) return BackgroundTask.BackgroundTaskResult.Success;

    const stepCount = await db
      .select()
      .from(taskStepExecutions)
      .where(eq(taskStepExecutions.execution_id, execution.id));
    await updateProgressNotification(
      execution.id,
      execution.current_step_index + 1,
      stepCount.length,
      execution.last_action || 'Running...'
    );
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.error('[ForegroundTask] Task handler error:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function cancelForegroundTask(executionId: string) {
  if (!db) return;
  await db
    .update(taskExecutions)
    .set({
      status: 'cancelled',
      completed_at: Date.now(),
      cancelled: true,
    })
    .where(eq(taskExecutions.id, executionId));

  useForegroundTaskStore.setState({
    execution_id: null,
    isRunning: false,
    isCancelled: true,
  });

  await cancelNotification(FOREGROUND_NOTIFICATION_ID);
  await cancelNotification(APPROVAL_NOTIFICATION_ID);
  console.log(`[ForegroundTask] Cancelled execution: ${executionId}`);
}

export async function pauseForApproval(
  executionId: string,
  action: string
) {
  if (!db) return;
  await db
    .update(taskExecutions)
    .set({
      status: 'interrupted',
      awaiting_approval: true,
    })
    .where(eq(taskExecutions.id, executionId));

  useForegroundTaskStore.setState({
    isPaused: true,
    isRunning: false,
    awaitingApproval: true,
    lastAction: action,
  });

  await showApprovalNotification(executionId, action);
  console.log(`[ForegroundTask] Paused for approval: ${executionId}`);
}

export async function resumeForegroundTask(executionId: string) {
  if (!db) return;
  await db
    .update(taskExecutions)
    .set({
      status: 'running',
      awaiting_approval: false,
    })
    .where(eq(taskExecutions.id, executionId));

  useForegroundTaskStore.setState({
    isPaused: false,
    isRunning: true,
    awaitingApproval: false,
    execution_id: executionId,
  });

  await cancelNotification(APPROVAL_NOTIFICATION_ID);
  console.log(`[ForegroundTask] Resumed execution: ${executionId}`);
}

export async function markInterruptedOnStartup() {
  if (!db) return;
  try {
    await db
      .update(taskExecutions)
      .set({
        status: 'interrupted',
        interrupted: true,
      })
      .where(
        and(
          eq(taskExecutions.status, 'running'),
          eq(taskExecutions.cancelled, false)
        )
      );
    console.log('[ForegroundTask] Marked interrupted executions after restart');
  } catch (e) {
    console.error('[ForegroundTask] Failed to mark interrupted executions:', e);
  }
}
