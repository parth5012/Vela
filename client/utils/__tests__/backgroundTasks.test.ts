import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { useConfigStore } from '../../store/useConfigStore';
import {
  VELA_BACKGROUND_TASK,
  executeVelaBackgroundTask,
  registerVelaBackgroundTask,
} from '../backgroundTasks';
import * as taskRunner from '../taskRunner';
import * as checkinScheduler from '../checkinScheduler';

const initialDefineTaskCalls = (TaskManager.defineTask as jest.Mock).mock.calls.slice();

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: {
    Success: 1,
    Failed: 2,
  },
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

const mockTaskRunsInsert = jest.fn();
const mockTaskRunsUpdate = jest.fn();
const mockTasksUpdate = jest.fn();
let mockActiveTasks: any[] = [];

jest.mock('../../db/client', () => {
  const mockDb = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(async () => mockActiveTasks),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(async (vals: any) => {
        mockTaskRunsInsert(vals);
      }),
    })),
    update: jest.fn(() => ({
      set: jest.fn((updates: any) => ({
        where: jest.fn(async () => {
          if (updates?.status) {
            mockTaskRunsUpdate(updates);
          } else if (updates?.next_run !== undefined) {
            mockTasksUpdate(updates);
          }
        }),
      })),
    })),
  };

  return {
    __esModule: true,
    db: mockDb,
    default: mockDb,
    expoDb: {},
    initializeDatabase: jest.fn(async () => {}),
  };
});

jest.mock('../taskRunner', () => ({
  runTask: jest.fn(),
  resolveTaskMode: jest.fn(),
}));

jest.mock('../checkinScheduler', () => ({
  isCheckinSchedulerTask: jest.fn(() => false),
  gateCheckinTask: jest.fn(),
  presentCheckinNotification: jest.fn(),
  NUDGE_TASK_ID: 'vela-nudge',
}));

describe('backgroundTasks scheduler (wayfinder #363)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTaskRunsInsert.mockClear();
    mockTaskRunsUpdate.mockClear();
    mockTasksUpdate.mockClear();
    mockActiveTasks = [];

    // Explicitly unset backend server credentials (simulating pure standalone mode)
    useConfigStore.setState({
      apiUrl: '',
      apiKey: '',
      connectionMode: 'local',
      localModelName: 'Needle-2 45M',
    });
  });

  it('registers background task handler with TaskManager', () => {
    expect(initialDefineTaskCalls).toContainEqual([
      VELA_BACKGROUND_TASK,
      executeVelaBackgroundTask,
    ]);
  });

  it('registers background task with 15-minute minimum interval', async () => {
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValueOnce(false);
    await registerVelaBackgroundTask();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(
      VELA_BACKGROUND_TASK,
      { minimumInterval: 15 }
    );
  });

  it('executes due tasks when apiUrl and apiKey are completely unset (no credential gate short-circuit)', async () => {
    const dueTask = {
      id: 'task-standalone-1',
      title: 'Local Standalone Task',
      description: 'Runs offline',
      status: 'active',
      recurrence_rule: '24h',
      linked_agent: 'personal assistant',
      task_prompt: 'Perform offline summary',
      connection_mode: 'local',
      last_run: null,
      next_run: Date.now() - 1000,
      created_at: Date.now() - 10000,
    };
    mockActiveTasks = [dueTask];

    (taskRunner.runTask as jest.Mock).mockResolvedValueOnce('Offline summary succeeded');

    const result = await executeVelaBackgroundTask({});

    expect(result).toBe(BackgroundTask.BackgroundTaskResult.Success);
    expect(taskRunner.runTask).toHaveBeenCalledWith(dueTask, 'local');

    // Verifies task_runs row transitioned running -> completed with output
    expect(mockTaskRunsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 'task-standalone-1',
        status: 'running',
      })
    );
    expect(mockTaskRunsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        output: 'Offline summary succeeded',
      })
    );

    // Verifies schedule was advanced
    expect(mockTasksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        last_run: expect.any(Number),
        next_run: expect.any(Number),
      })
    );
    expect(mockTasksUpdate.mock.calls[0][0].next_run).toBeGreaterThan(Date.now());
  });

  it('produces failed task_runs row with reason AND advances next_run when mode is unavailable', async () => {
    const misconfiguredTask = {
      id: 'task-cloud-unconfigured',
      title: 'Cloud Task Without Key',
      description: null,
      status: 'active',
      recurrence_rule: '1h',
      linked_agent: 'personal assistant',
      task_prompt: 'Run something in cloud',
      connection_mode: 'cloud',
      last_run: null,
      next_run: Date.now() - 5000,
      created_at: Date.now() - 10000,
    };
    mockActiveTasks = [misconfiguredTask];

    (taskRunner.runTask as jest.Mock).mockRejectedValueOnce(
      new Error('Mode "cloud" not configured: no cloud provider key')
    );

    const result = await executeVelaBackgroundTask({});

    expect(result).toBe(BackgroundTask.BackgroundTaskResult.Success);
    expect(taskRunner.runTask).toHaveBeenCalledWith(misconfiguredTask, 'cloud');

    // Verifies failed status and human-readable reason written to task_runs.output
    expect(mockTaskRunsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        output: 'Mode "cloud" not configured: no cloud provider key',
      })
    );

    // Verifies next_run was still advanced into future so task does not wedge
    expect(mockTasksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        last_run: expect.any(Number),
        next_run: expect.any(Number),
      })
    );
    const updatedNextRun = mockTasksUpdate.mock.calls[0][0].next_run;
    expect(updatedNextRun).toBeGreaterThan(Date.now());
  });

  it('preserves check-in scheduler gating when check-in row is suppressed', async () => {
    const checkinTask = {
      id: 'vela-nudge',
      title: 'Checkin Nudge',
      description: 'vela:checkin',
      status: 'active',
      recurrence_rule: '24h',
      linked_agent: 'check-in',
      task_prompt: 'Check in with user',
      connection_mode: null,
      last_run: null,
      next_run: Date.now() - 1000,
      created_at: Date.now() - 20000,
    };
    mockActiveTasks = [checkinTask];

    (checkinScheduler.isCheckinSchedulerTask as unknown as jest.Mock).mockReturnValueOnce(true);
    (checkinScheduler.gateCheckinTask as jest.Mock).mockResolvedValueOnce({
      fire: false,
      reason: 'User already checked in today',
    });

    const result = await executeVelaBackgroundTask({});

    expect(result).toBe(BackgroundTask.BackgroundTaskResult.Success);
    expect(taskRunner.runTask).not.toHaveBeenCalled();

    // Verifies suppressed row records completed with gate reason
    expect(mockTaskRunsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 'vela-nudge',
        status: 'completed',
        output: 'User already checked in today',
      })
    );

    // Verifies schedule advances without firing
    expect(mockTasksUpdate).toHaveBeenCalled();
  });
});
