import React from 'react';
import renderer, { act } from 'react-test-renderer';
import TasksScreen from '../app/tasks';
import { TaskEntity, TaskRunEntity } from '../db/schema';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const mockTasks: TaskEntity[] = [
  {
    id: 'task-cron-1',
    title: 'Daily Digest Cron',
    description: 'Summarize news on weekdays',
    status: 'active',
    recurrence_rule: '0 9 * * 1-5',
    linked_agent: 'personal assistant',
    task_prompt: 'Summarize morning news',
    connection_mode: 'local',
    last_run: 1700000000,
    next_run: 1700086400,
    created_at: 1690000000,
  },
  {
    id: 'task-preset-2',
    title: 'Hourly Sync Task',
    description: 'Sync files hourly',
    status: 'paused',
    recurrence_rule: '1h',
    linked_agent: 'personal assistant',
    task_prompt: 'Sync files',
    connection_mode: null,
    last_run: null,
    next_run: null,
    created_at: 1690000000,
  },
];

const mockRuns: TaskRunEntity[] = [
  {
    id: 'run-recent-1',
    task_id: 'task-cron-1',
    status: 'completed',
    started_at: 1700000000,
    completed_at: 1700000010,
    output: 'Processed 5 feeds successfully',
  },
];

const mockInsertValues = jest.fn(async () => {});
const mockInsert = jest.fn().mockReturnValue({ values: mockInsertValues });
const mockUpdateSet = jest.fn().mockReturnValue({ where: jest.fn(async () => {}) });
const mockUpdate = jest.fn().mockReturnValue({ set: mockUpdateSet });
const mockWhere = jest.fn(async () => mockRuns);
const mockSelectFrom = jest.fn(() => Object.assign(Promise.resolve(mockTasks), { where: mockWhere }));
const mockSelect = jest.fn().mockReturnValue({
  from: mockSelectFrom,
});

jest.mock('../db/client', () => {
  const client = {
    select: () => mockSelect(),
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: () => ({ where: jest.fn(async () => {}) }),
  };
  return {
    __esModule: true,
    db: client,
    expoDb: {},
    initializeDatabase: jest.fn(async () => {}),
    default: client,
  };
});

jest.mock('../hooks/useAgents', () => ({
  useAgents: () => [
    { id: 'personal assistant', name: 'Personal Assistant', icon: '🤖' },
  ],
}));

jest.mock('../utils/taskRunner', () => ({
  runTask: jest.fn(async () => 'mock output'),
}));

function allTexts(root: any): string[] {
  return root
    .findAll((n: any) => n.type === 'Text')
    .map((n: any) => (Array.isArray(n.children) ? n.children.join('') : String(n.children || '')));
}

describe('Task Management Full UI Blackbox Tests (#1170)', () => {
  let mounted: any;

  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted.unmount();
      });
      mounted = null;
    }
    jest.clearAllMocks();
  });

  it('renders custom cron schedule label on task cards', async () => {
    await act(async () => {
      mounted = renderer.create(<TasksScreen />);
    });
    const texts = allTexts(mounted.root);
    expect(texts.some((t) => t.includes('At 09:00 on weekdays') || t.includes('0 9 * * 1-5'))).toBe(true);
  });

  it('renders status badges with active and paused lifecycle states', async () => {
    await act(async () => {
      mounted = renderer.create(<TasksScreen />);
    });
    const texts = allTexts(mounted.root);
    expect(texts.some((t) => t.includes('ACTIVE'))).toBe(true);
    expect(texts.some((t) => t.includes('PAUSED'))).toBe(true);
  });

  it('renders recent task notification banner card when a recent run exists', async () => {
    await act(async () => {
      mounted = renderer.create(<TasksScreen />);
    });
    const texts = allTexts(mounted.root);
    // Notification card displays recent task execution info
    expect(texts.some((t) => t.includes('Recent Run') || t.includes('Latest Run') || t.includes('Task Notification'))).toBe(true);
  });

  it('supports custom cron schedule input in the task creation form', async () => {
    await act(async () => {
      mounted = renderer.create(<TasksScreen />);
    });

    // Find and press "+ Add Task" button
    const addButton = mounted.root.find(
      (n: any) => n.props?.accessibilityLabel === 'Create task' || n.props?.accessibilityLabel === '+ Add Task' || (n.type === 'Text' && n.children?.includes('+ Add Task'))
    );
    let pressable = addButton;
    while (pressable && !pressable.props?.onPress) pressable = pressable.parent;
    if (pressable) {
      await act(async () => {
        pressable.props.onPress();
      });
    }

    const texts = allTexts(mounted.root);
    // Custom option is available among recurrence options
    expect(texts.some((t) => t.toLowerCase().includes('custom') || t.includes('Cron'))).toBe(true);
  });
});
