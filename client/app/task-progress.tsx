import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  db,
  initializeDatabase,
} from '../db/client';
import {
  taskExecutions,
  taskStepExecutions,
  tasks,
} from '../db/schema';
import { eq } from 'drizzle-orm';
import useForegroundTaskStore from '../store/useForegroundTaskStore';
import {
  cancelForegroundTask,
  pauseForegroundTask,
  resumeForegroundTask,
} from '../utils/foregroundTaskRunner';
import * as Notifications from 'expo-notifications';

// Set up notification handler for button presses
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function TaskProgressScreen() {
  const router = useRouter();
  const { execution_id } = useLocalSearchParams<{ execution_id: string }>();
  const [execution, setExecution] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const {
    isRunning,
    isCancelled,
    isPaused,
    currentStep,
    setLastAction,
  } = useForegroundTaskStore();

  useEffect(() => {
    loadExecution();
  }, [execution_id]);

  const loadExecution = async () => {
    if (!execution_id || !db) return;

    await initializeDatabase();

    const execData = await db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.id, execution_id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!execData) {
      setLoading(false);
      return;
    }

    setExecution(execData);

    const taskData = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, execData.task_id))
      .limit(1)
      .then((rows) => rows[0]);
    setTask(taskData);

    const stepsData = await db
      .select()
      .from(taskStepExecutions)
      .where(eq(taskStepExecutions.execution_id, execution_id))
      .orderBy(taskStepExecutions.step_index);
    setSteps(stepsData);

    setLoading(false);
  };

  const handleCancel = async () => {
    if (!execution_id) return;
    await cancelForegroundTask(execution_id);
    router.replace('/tasks');
  };

  const handlePause = async () => {
    if (!execution_id) return;
    await pauseForApproval(execution_id, 'Task paused for approval');
  };

  const handleResume = async () => {
    if (!execution_id) return;
    await resumeForegroundTask(execution_id);
  };

  const handleConfirmApproval = async () => {
    if (!execution_id) return;
    await resumeForegroundTask(execution_id);
  };

  const handleDenyApproval = async () => {
    if (!execution_id) return;
    await cancelForegroundTask(execution_id);
    router.replace('/tasks');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!execution) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Task execution not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace('/tasks')}
        >
          <Text style={styles.backButtonText}>Back to Tasks</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stepProgress = task
    ? `${execution.current_step_index}/${task.steps?.length || steps.length}`
    : `${execution.current_step_index}/${steps.length}`;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Task Progress</Text>
        <Text style={styles.taskTitle}>{task?.title || 'Running Task'}</Text>
      </View>

      {/* Status Badge */}
      <View style={styles.statusContainer}>
        {isCancelled ? (
          <View style={[styles.statusBadge, styles.statusCancelled]}>
            <Text style={styles.statusText}>Cancelled</Text>
          </View>
        ) : isPaused ? (
          <View style={[styles.statusBadge, styles.statusPaused]}>
            <Text style={styles.statusText}>Paused</Text>
          </View>
        ) : (
          <View style={[styles.statusBadge, styles.statusRunning]}>
            <Text style={styles.statusText}>Running</Text>
          </View>
        )}
      </View>

      {/* Progress */}
      <View style={styles.progressSection}>
        <Text style={styles.progressText}>Step {stepProgress}</Text>
        <Text style={styles.lastAction}>{execution.last_action || 'Starting...'}</Text>
      </View>

      {/* Steps List */}
      <View style={styles.stepsSection}>
        <Text style={styles.stepsTitle}>Steps</Text>
        {steps.map((step, index) => (
          <View
            key={step.id}
            style={[
              styles.stepItem,
              step.status === 'completed' && styles.stepCompleted,
              step.status === 'running' && styles.stepRunning,
            ]}
          >
            <Text style={styles.stepNumber}>{index + 1}</Text>
            <Text style={styles.stepDescription}>
              {step.description || `Step ${index + 1}`}
            </Text>
            {step.status === 'completed' && (
              <Text style={styles.stepCheckmark}>✓</Text>
            )}
            {step.status === 'running' && (
              <ActivityIndicator size="small" color="#007AFF" />
            )}
          </View>
        ))}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {!isCancelled && !isPaused && (
          <TouchableOpacity
            style={[styles.button, styles.pauseButton]}
            onPress={handlePause}
          >
            <Text style={styles.buttonText}>Pause</Text>
          </TouchableOpacity>
        )}

        {isPaused && !isCancelled && (
          <TouchableOpacity
            style={[styles.button, styles.resumeButton]}
            onPress={handleResume}
          >
            <Text style={styles.buttonText}>Resume</Text>
          </TouchableOpacity>
        )}

        {!isCancelled && (
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={handleCancel}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Approval Dialog (if awaiting approval) */}
      {execution.awaiting_approval && (
        <View style={styles.approvalContainer}>
          <Text style={styles.approvalTitle}>Approval Required</Text>
          <Text style={styles.approvalMessage}>
            This action requires your confirmation.
          </Text>
          <View style={styles.approvalButtons}>
            <TouchableOpacity
              style={[styles.approvalButton, styles.confirmButton]}
              onPress={handleConfirmApproval}
            >
              <Text style={styles.buttonText}>Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.approvalButton, styles.denyButton]}
              onPress={handleDenyApproval}
            >
              <Text style={styles.buttonText}>Deny</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
  },
  taskTitle: {
    fontSize: 18,
    color: '#666',
    marginTop: 4,
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  statusBadge: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  statusRunning: {
    backgroundColor: '#E8F5E9',
  },
  statusPaused: {
    backgroundColor: '#FFF3E0',
  },
  statusCancelled: {
    backgroundColor: '#FFEBEE',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressSection: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  progressText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  lastAction: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  stepsSection: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  stepsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  stepNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E5E5EA',
    textAlign: 'center',
    lineHeight: 30,
    fontWeight: '600',
  },
  stepCompleted: {
    backgroundColor: '#E8F5E9',
  },
  stepRunning: {
    backgroundColor: '#E3F2FD',
  },
  stepDescription: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
  },
  stepCheckmark: {
    fontSize: 20,
    color: '#4CAF50',
    marginLeft: 8,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  pauseButton: {
    backgroundColor: '#FF9500',
  },
  resumeButton: {
    backgroundColor: '#4CAF50',
  },
  cancelButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  approvalContainer: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },
  approvalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 8,
  },
  approvalMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  approvalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  approvalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButton: {
    backgroundColor: '#4CAF50',
  },
  denyButton: {
    backgroundColor: '#FF3B30',
  },
  backButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  backButtonText: {
    color: '#FFF',
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    marginBottom: 16,
  },
});
