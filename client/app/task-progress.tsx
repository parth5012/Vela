import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { db, initializeDatabase } from '../db/client';
import { taskExecutions, taskStepExecutions, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import useForegroundTaskStore from '../store/useForegroundTaskStore';
import {
  cancelForegroundTask,
  resumeForegroundTask,
} from '../utils/foregroundTaskRunner';
import { AuroraScreen, Card, PrimaryButton, useAurora } from '../components/ui/settingsKit';

type LoadState = 'loading' | 'empty' | 'active' | 'error';

function SkeletonCard({ colors }: { colors: any }) {
  return (
    <Card style={[styles.skeletonCard, { borderColor: colors.glassBorder, backgroundColor: colors.glass }]}>
      <View style={[styles.skeletonLine, { backgroundColor: 'rgba(255,255,255,0.08)', width: '60%' }]} />
      <View style={[styles.skeletonLine, { backgroundColor: 'rgba(255,255,255,0.06)', width: '85%', height: 12 }]} />
      <View style={[styles.skeletonBar, { backgroundColor: 'rgba(255,255,255,0.07)' }]}>
        <View style={[styles.skeletonBarFill, { backgroundColor: 'rgba(255,255,255,0.12)', width: '45%' }]} />
      </View>
    </Card>
  );
}

export default function TaskProgressScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string; execution_id?: string; executionId?: string }>();
  // Plan requires reading taskId from useLocalSearchParams; keep backward compat with execution_id
  const taskIdParam = (params.taskId ?? (params as any).execution_id ?? (params as any).executionId) as string | undefined;

  const { colors, sizes, aurora } = useAurora();
  const { execution_id: storeExecutionId, currentStep, isRunning, isCancelled, isPaused, lastAction, task_plan } =
    useForegroundTaskStore();

  const effectiveId = taskIdParam || storeExecutionId || null;

  const [execution, setExecution] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [task, setTask] = useState<any>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const loadExecution = useCallback(async () => {
    setLoadState('loading');
    setErrorMessage(null);
    try {
      if (!effectiveId) {
        // No id and no store execution -> empty state (no active task)
        // Small delay to show skeleton briefly for perceived loading
        await new Promise((r) => setTimeout(r, 350));
        setExecution(null);
        setSteps([]);
        setTask(null);
        setLoadState('empty');
        return;
      }

      if (!db) {
        await initializeDatabase();
      }
      if (!db) {
        throw new Error('Database not available');
      }
      await initializeDatabase().catch(() => {});

      // Try direct execution id match first
      let execData: any = null;
      try {
        const rows = await db
          .select()
          .from(taskExecutions)
          .where(eq(taskExecutions.id, effectiveId))
          .limit(1);
        execData = rows[0] || null;
      } catch {
        execData = null;
      }

      // If not found and param looks like a task id, try latest execution for that task
      if (!execData && taskIdParam) {
        try {
          const byTask = await db
            .select()
            .from(taskExecutions)
            .where(eq(taskExecutions.task_id, taskIdParam));
          if (byTask.length > 0) {
            // Most recent by started_at desc
            byTask.sort((a: any, b: any) => (b.started_at || 0) - (a.started_at || 0));
            execData = byTask[0];
          }
        } catch {
          // ignore
        }
      }

      // Fallback to store's execution_id if we used taskId param but store has different
      if (!execData && storeExecutionId && storeExecutionId !== effectiveId) {
        try {
          const rows = await db
            .select()
            .from(taskExecutions)
            .where(eq(taskExecutions.id, storeExecutionId))
            .limit(1);
          execData = rows[0] || null;
        } catch {
          // ignore
        }
      }

      if (!execData) {
        // If we have a live store task_plan but no DB row yet, treat as active (store-driven)
        if (storeExecutionId && task_plan) {
          setExecution({
            id: storeExecutionId,
            task_id: task_plan.task_id,
            status: isRunning ? 'running' : isPaused ? 'interrupted' : 'pending',
            current_step_index: currentStep,
            last_action: lastAction,
          });
          // Build pseudo steps from task_plan
          const pseudoSteps = task_plan.steps.map((s: any, idx: number) => ({
            id: s.id,
            description: s.description,
            step_index: idx,
            status: idx < currentStep ? 'completed' : idx === currentStep ? 'running' : 'pending',
          }));
          setSteps(pseudoSteps);
          try {
            const tRows = await db.select().from(tasks).where(eq(tasks.id, task_plan.task_id)).limit(1);
            setTask(tRows[0] || null);
          } catch {
            setTask(null);
          }
          setLoadState('active');
          return;
        }
        // No execution at all
        if (!storeExecutionId && !taskIdParam) {
          setLoadState('empty');
        } else {
          setErrorMessage('Task execution not found');
          setLoadState('error');
        }
        return;
      }

      setExecution(execData);

      // Load linked task
      try {
        const taskRows = await db.select().from(tasks).where(eq(tasks.id, execData.task_id)).limit(1);
        setTask(taskRows[0] || null);
      } catch {
        setTask(null);
      }

      // Load steps
      try {
        const stepsData = await db
          .select()
          .from(taskStepExecutions)
          .where(eq(taskStepExecutions.execution_id, execData.id))
          .orderBy(taskStepExecutions.step_index);
        setSteps(stepsData);
      } catch {
        setSteps([]);
      }

      // Determine state: if cancelled/failed/interrupted with no store running -> could be error/timeout
      if (execData.status === 'failed' || execData.status === 'cancelled') {
        // Still show active with status badge but also allow retry; map to active for progress view
        setLoadState('active');
      } else {
        setLoadState('active');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load task');
      setLoadState('error');
    }
  }, [effectiveId, taskIdParam, storeExecutionId, currentStep, isRunning, isPaused, lastAction, task_plan]);

  useEffect(() => {
    loadExecution();
  }, [loadExecution, retryKey]);

  // Also react to store updates for live progress (poll via store subscription already via Zustand)
  // No extra polling needed; store changes trigger re-render

  const handleRetry = () => {
    setRetryKey((k) => k + 1);
  };

  const handleCancel = async () => {
    const id = execution?.id || effectiveId;
    if (!id) return;
    await cancelForegroundTask(id);
    router.replace('/tasks');
  };

  const handleResume = async () => {
    const id = execution?.id || effectiveId;
    if (!id) return;
    await resumeForegroundTask(id);
    handleRetry();
  };

  // Timeout: if loading too long, parent will show error; we handle via loadState

  const totalSteps = task_plan?.steps?.length || task?.steps?.length || steps.length || 1;
  const currentIdx = typeof currentStep === 'number' ? currentStep : execution?.current_step_index ?? 0;
  const displayStep = Math.min(currentIdx + 1, totalSteps);
  const progressPct = totalSteps > 0 ? Math.min(100, Math.round((currentIdx / totalSteps) * 100)) : 0;
  const currentActionText = lastAction || execution?.last_action || 'Starting...';

  const renderLoading = () => (
    <View style={styles.statesGap}>
      <SkeletonCard colors={colors} />
      <SkeletonCard colors={colors} />
      <SkeletonCard colors={colors} />
      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <ActivityIndicator size="small" color={aurora.acc1} />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub, marginTop: 8 }}>Loading task…</Text>
      </View>
    </View>
  );

  const renderEmpty = () => (
    <Card style={{ gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>No active task</Text>
      <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 18 }}>
        There is no task currently running. Create or start a task to track its progress here.
      </Text>
      <PrimaryButton label="Go to Tasks" onPress={() => router.push('/tasks')} />
    </Card>
  );

  const renderError = () => (
    <Card style={{ gap: 12, borderColor: 'rgba(239,68,68,0.35)' }}>
      <Text style={{ color: '#f87171', fontSize: sizes.text, fontWeight: '700' }}>Something went wrong</Text>
      <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 18 }}>
        {errorMessage || 'The task could not be loaded or timed out.'}
      </Text>
      <PrimaryButton label="Retry" onPress={handleRetry} />
      <Pressable
        onPress={() => router.push('/tasks')}
        style={{ alignItems: 'center', paddingVertical: 10, minHeight: 48, justifyContent: 'center' }}
        accessibilityRole="button"
        accessibilityLabel="Go to Tasks"
      >
        <Text style={{ color: colors.textMuted, fontSize: sizes.text, fontWeight: '600' }}>Go to Tasks</Text>
      </Pressable>
    </Card>
  );

  const renderActive = () => (
    <View style={styles.statesGap}>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '700' }} numberOfLines={1}>
            {task?.title || 'Running Task'}
          </Text>
          {isCancelled ? (
            <View style={[styles.badge, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Text style={[styles.badgeText, { color: '#f87171' }]}>Cancelled</Text>
            </View>
          ) : isPaused || execution?.awaiting_approval ? (
            <View style={[styles.badge, { backgroundColor: 'rgba(251,146,60,0.15)' }]}>
              <Text style={[styles.badgeText, { color: '#fb923c' }]}>Paused</Text>
            </View>
          ) : (
            <View style={[styles.badge, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
              <Text style={[styles.badgeText, { color: '#10b981' }]}>Running</Text>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ color: aurora.acc1, fontSize: 22, fontWeight: '800' }}>
            Step {displayStep}/{totalSteps}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>
            {isRunning ? 'in progress' : isPaused ? 'paused' : execution?.status || 'pending'}
          </Text>
        </View>

        <Text style={{ color: colors.textMuted, fontSize: sizes.sub, lineHeight: 16 }} numberOfLines={2}>
          {currentActionText}
        </Text>

        {/* Progress bar with aurora.acc1 */}
        <View style={[styles.progressBg, { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder }]}>
          <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: aurora.acc1 }]} />
        </View>
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, textAlign: 'right' }}>{progressPct}%</Text>
      </Card>

      {/* Steps list */}
      <Card style={{ gap: 0 }}>
        <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600', marginBottom: 12 }}>Steps</Text>
        {steps.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub, textAlign: 'center', paddingVertical: 12 }}>
            No steps recorded
          </Text>
        ) : (
          steps.map((step: any, index: number) => {
            const status: string = step.status || (index < currentIdx ? 'completed' : index === currentIdx ? 'running' : 'pending');
            return (
              <View
                key={step.id || `${index}`}
                style={[
                  styles.stepItem,
                  { borderBottomColor: colors.glassBorder },
                  status === 'completed' && { backgroundColor: 'rgba(16,185,129,0.06)' },
                  status === 'running' && { backgroundColor: 'rgba(59,130,246,0.08)' },
                ]}
              >
                <View style={[styles.stepNumber, { backgroundColor: status === 'completed' ? '#10b981' : status === 'running' ? aurora.acc1 : 'rgba(255,255,255,0.12)' }]}>
                  <Text style={{ color: status === 'completed' || status === 'running' ? '#fff' : colors.textMuted, fontWeight: '700', fontSize: 12, textAlign: 'center', lineHeight: 26 }}>
                    {status === 'completed' ? '✓' : index + 1}
                  </Text>
                </View>
                <Text style={[styles.stepDescription, { color: colors.text }]} numberOfLines={2}>
                  {step.description || (task_plan?.steps?.[index]?.description) || `Step ${index + 1}`}
                </Text>
                {status === 'running' ? <ActivityIndicator size="small" color={aurora.acc1} style={{ marginLeft: 8 }} /> : null}
              </View>
            );
          })
        )}
      </Card>

      {/* Controls */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {isPaused ? (
          <Pressable
            onPress={handleResume}
            style={({ pressed }) => [styles.controlBtn, { backgroundColor: '#10b981' }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Resume task"
          >
            <Text style={styles.controlBtnText}>Resume</Text>
          </Pressable>
        ) : !isCancelled ? (
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [styles.controlBtn, { backgroundColor: 'rgba(239,68,68,0.9)' }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel task"
          >
            <Text style={styles.controlBtnText}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push('/tasks')}
          style={({ pressed }) => [styles.controlBtn, { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: colors.glassBorder }, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="View all tasks"
        >
          <Text style={[styles.controlBtnText, { color: colors.text }]}>View Tasks</Text>
        </Pressable>
      </View>
    </View>
  );

  let content: React.ReactNode = null;
  if (loadState === 'loading') content = renderLoading();
  else if (loadState === 'error') content = renderError();
  else if (loadState === 'empty') content = renderEmpty();
  else content = renderActive();

  return (
    <AuroraScreen title="Task Progress" subtitle={loadState === 'active' ? currentActionText : undefined}>
      {content}
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  statesGap: {
    gap: 16,
  },
  skeletonCard: {
    gap: 12,
    minHeight: 92,
  },
  skeletonLine: {
    height: 16,
    borderRadius: 6,
  },
  skeletonBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
  },
  skeletonBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressBg: {
    height: 8,
    borderWidth: 1,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    gap: 12,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDescription: {
    flex: 1,
    fontSize: 13,
    lineHeight: 16,
  },
  controlBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  controlBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
