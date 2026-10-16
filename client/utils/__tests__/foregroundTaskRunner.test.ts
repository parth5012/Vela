import * as Notifications from 'expo-notifications';
import { useConfigStore } from '../../store/useConfigStore';
import useForegroundTaskStore from '../../store/useForegroundTaskStore';
import {
  pauseForApproval,
  resumeForegroundTask,
  cancelForegroundTask,
  markInterruptedOnStartup,
  APPROVAL_NOTIFICATION_ID,
  FOREGROUND_NOTIFICATION_ID,
} from '../foregroundTaskRunner';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { NONE: 0, DEFAULT: 3, HIGH: 4, MAX: 5, LOW: 2 },
  AndroidNotificationPriority: { DEFAULT: 0, LOW: 1, HIGH: 2, MAX: 3 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));

const mockDbUpdates: any[] = [];

jest.mock('../../db/client', () => {
  const mockDb = {
    update: jest.fn(() => ({
      set: jest.fn((updates: any) => {
        mockDbUpdates.push(updates);
        return {
          where: jest.fn(async () => undefined),
        };
      }),
    })),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => []),
          orderBy: jest.fn(() => ({
            limit: jest.fn(async () => []),
          })),
        })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(async () => undefined),
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

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-1234'),
}));

describe('foregroundTaskRunner (System B approval path standalone verification #364)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbUpdates.length = 0;

    // Explicitly unsetting credentials to confirm approval gates operate strictly offline
    useConfigStore.setState({
      apiUrl: '',
      apiKey: '',
      connectionMode: 'local',
      localModelName: 'Needle-2 45M',
    });

    useForegroundTaskStore.setState({
      execution_id: 'exec-test-1',
      task_plan: { task_id: 't-1', steps: [] },
      currentStep: 0,
      isRunning: true,
      isCancelled: false,
      isPaused: false,
      awaitingApproval: false,
      lastAction: 'Running step',
    });
  });

  it('pauses for approval with apiUrl and apiKey unset (offline approval gate)', async () => {
    await pauseForApproval('exec-test-1', 'Confirm send transaction');

    // Asserts SQLite taskExecutions updated to interrupted + awaiting_approval
    expect(mockDbUpdates).toContainEqual({
      status: 'interrupted',
      awaiting_approval: true,
    });

    // Asserts in-memory foreground task store reflects approval pause
    const state = useForegroundTaskStore.getState();
    expect(state.isPaused).toBe(true);
    expect(state.isRunning).toBe(false);
    expect(state.awaitingApproval).toBe(true);
    expect(state.lastAction).toBe('Confirm send transaction');

    // Asserts local notification presented without network dependency
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: APPROVAL_NOTIFICATION_ID,
      content: expect.objectContaining({
        title: 'Vela needs your approval',
        body: 'Confirm send transaction',
        data: { type: 'approval_needed', execution_id: 'exec-test-1' },
      }),
      trigger: null,
    });
  });

  it('resumes foreground task with apiUrl and apiKey unset', async () => {
    // Start from paused state
    useForegroundTaskStore.setState({
      isPaused: true,
      isRunning: false,
      awaitingApproval: true,
      execution_id: 'exec-test-1',
    });

    await resumeForegroundTask('exec-test-1');

    // Asserts SQLite taskExecutions updated to running + awaiting_approval: false
    expect(mockDbUpdates).toContainEqual({
      status: 'running',
      awaiting_approval: false,
    });

    // Asserts in-memory store resumed
    const state = useForegroundTaskStore.getState();
    expect(state.isPaused).toBe(false);
    expect(state.isRunning).toBe(true);
    expect(state.awaitingApproval).toBe(false);
    expect(state.execution_id).toBe('exec-test-1');

    // Asserts approval notification cancelled locally
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      APPROVAL_NOTIFICATION_ID
    );
  });

  it('cancels foreground task and clears notifications offline', async () => {
    await cancelForegroundTask('exec-test-1');

    expect(mockDbUpdates).toContainEqual(
      expect.objectContaining({
        status: 'cancelled',
        cancelled: true,
        completed_at: expect.any(Number),
      })
    );

    const state = useForegroundTaskStore.getState();
    expect(state.execution_id).toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.isCancelled).toBe(true);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      FOREGROUND_NOTIFICATION_ID
    );
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      APPROVAL_NOTIFICATION_ID
    );
  });

  it('marks interrupted tasks on startup without backend requests', async () => {
    await markInterruptedOnStartup();

    expect(mockDbUpdates).toContainEqual({
      status: 'interrupted',
      interrupted: true,
    });
  });
});
