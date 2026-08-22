import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { randomUUID } from 'expo-crypto';
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

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'interrupted';

export interface StepDefinition {
  id: string;
  description: string;
  action: string;
}

export interface TaskPlan {
  task_id: string;
  steps: StepDefinition[];
}

interface ForegroundTaskState {
  execution_id: string | null;
  task_plan: TaskPlan | null;
  current_step: number;
  is_running: boolean;
  is_cancelled: boolean;
  is_paused: boolean;
  last_action: string;
}

export async function ensureForegroundChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(
      FOREGROUND_NOTIFICATION_CHANNEL,
      {
        name: 'Vela Automation Tasks',
        importance: Notifications.AndroidImportance.LOW,
        lightColor: '#FF231F71',
        vibrationPattern: [0, 0],
      }
    );
    await Notifications.setNotificationChannelAsync('vela-approval', {
      name: 'Vela Approvals',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
  } catch (error) {
    console.warn('[ForegroundTask] Failed to create notification channels:', error);
  }
}

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

export async function registerForegroundTask() {
  await TaskManager.defineTask(VELA_FOREGROUND_TASK, async () => {
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function startForegroundService(
  taskId: string,
  taskPlan: TaskPlan
): Promise<string> {
  if (!db) throw new Error('Database not initialized');
  await ensureForegroundChannel();

  const existing = await db
    .select()
    .from(taskExecutions)
    .where(
      and(
        eq(taskExecutions.task_id, taskId),
        eq(taskExecutions.status, 'running')
      )
    )
    .limit(1)
    .then((rows: any[]) => rows[0]);
  if (existing) throw new Error('Task already running');

  const executionId = randomUUID();
  const now = Date.now();

  await db.insert(taskExecutions).values({
    id: executionId,
    task_id: taskId,
    status: 'running',
    current_step_index: 0,
    started_at: now,
    cancelled: false,
    interrupted: false,
    awaiting_approval: false,
    task_plan: JSON.stringify(taskPlan),
    last_action: 'Starting task...',
  });

  for (let i = 0; i < taskPlan.steps.length; i++) {
    await db.insert(taskStepExecutions).values({
      id: randomUUID(),
      execution_id: executionId,
      step_index: i,
      status: 'pending',
      started_at: now,
    });
  }

  useForegroundTaskStore.setState({
    execution_id: executionId,
    task_plan: taskPlan,
    currentStep: 0,
    isRunning: true,
    isCancelled: false,
    isPaused: false,
    lastAction: 'Starting task...',
  });

  await updateProgressNotification(executionId, 1, taskPlan.steps.length, 'Starting task...');
  console.log(`[ForegroundTask] Started execution: ${executionId}`);
  return executionId;
}

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

export async function completeStep(executionId: string, stepIndex: number, output?: string) {
  if (!db) return;
  const completedAt = Date.now();
  await db
    .update(taskStepExecutions)
    .set({
      status: 'completed',
      completed_at: completedAt,
      output: output || null,
    })
    .where(
      and(
        eq(taskStepExecutions.execution_id, executionId),
        eq(taskStepExecutions.step_index, stepIndex)
      )
    );

  const nextIndex = stepIndex + 1;
  await db
    .update(taskExecutions)
    .set({ current_step_index: nextIndex })
    .where(eq(taskExecutions.id, executionId));

  useForegroundTaskStore.setState({ currentStep: nextIndex });
}

export async function markExecutionCompleted(executionId: string, output?: string) {
  if (!db) return;
  await db
    .update(taskExecutions)
    .set({
      status: 'completed',
      completed_at: Date.now(),
    })
    .where(eq(taskExecutions.id, executionId));

  if (output) {
    await db
      .update(taskStepExecutions)
      .set({ output })
      .where(eq(taskStepExecutions.execution_id, executionId));
  }

  useForegroundTaskStore.setState({
    execution_id: null,
    isRunning: false,
    isCancelled: false,
  });

  await cancelNotification(FOREGROUND_NOTIFICATION_ID);
  await cancelNotification(APPROVAL_NOTIFICATION_ID);
  console.log(`[ForegroundTask] Completed execution: ${executionId}`);
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

export async function getLastInterruptedExecution() {
  if (!db) return null;
  const rows = await db
    .select()
    .from(taskExecutions)
    .where(eq(taskExecutions.status, 'interrupted'))
    .orderBy(taskExecutions.started_at)
    .limit(1);
  return rows[0] || null;
}

export function useForegroundTask(): ForegroundTaskState {
  const [state, setState] = useState<ForegroundTaskState>({
    execution_id: null,
    task_plan: null,
    current_step: 0,
    is_running: false,
    is_cancelled: false,
    is_paused: false,
    last_action: '',
  });

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const store = useForegroundTaskStore();

  useEffect(() => {
    setState({
      execution_id: store.execution_id,
      task_plan: store.task_plan,
      current_step: store.currentStep,
      is_running: store.isRunning,
      is_cancelled: store.isCancelled,
      is_paused: store.isPaused,
      last_action: store.lastAction,
    });
  }, [
    store.execution_id,
    store.task_plan,
    store.currentStep,
    store.isRunning,
    store.isCancelled,
    store.isPaused,
    store.lastAction,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        useForegroundTaskStore.setState({ isRunning: store.isRunning });
      }
      appStateRef.current = next;
    });
    return () => subscription.remove();
  }, [store.isRunning]);

  return state;
}

export default {
  startForegroundService,
  cancelForegroundTask,
  pauseForApproval,
  resumeForegroundTask,
  completeStep,
  markExecutionCompleted,
  markInterruptedOnStartup,
  getLastInterruptedExecution,
  updateProgressNotification,
  showApprovalNotification,
  useForegroundTask,
  registerForegroundTask,
  VELA_FOREGROUND_TASK,
};
