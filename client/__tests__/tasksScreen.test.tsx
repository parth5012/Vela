import React from 'react';
import renderer, { act } from 'react-test-renderer';
import TasksScreen from '../app/tasks';
import { useConfigStore } from '../store/useConfigStore';
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
    id: 'task-1',
    title: 'Daily News Digest',
    description: 'Summarize news feeds',
    status: 'active',
    recurrence_rule: '24h',
    linked_agent: 'personal assistant',
    task_prompt: 'Summarize news',
    connection_mode: 'local',
    last_run: null,
    next_run: 1700000000,
    created_at: 1690000000,
  },
  {
    id: 'task-2',
    title: 'Server Sync Task',
    description: 'Sync files',
    status: 'active',
    recurrence_rule: '1h',
    linked_agent: 'personal assistant',
    task_prompt: 'Sync files',
    connection_mode: null,
    last_run: null,
    next_run: 1700000000,
    created_at: 1690000000,
  },
];

const mockRuns: TaskRunEntity[] = [
  {
    id: 'run-fail-1',
    task_id: 'task-1',
    status: 'failed',
    started_at: 1700000000,
    completed_at: 1700000005,
    output: 'Mode "cloud" not configured: no cloud provider key',
  },
];

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn(async () => {}) });
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

function pressText(root: any, text: string) {
  let node = root.find(
    (n: any) => n.type === 'Text' && n.children?.includes(text)
  );
  while (node && !node.props?.onPress) node = node.parent;
  if (!node) throw new Error(`Cannot find pressable for text ${text}`);
  node.props.onPress();
}

function findTexts(root: any): string[] {
  return root
    .findAll((n: any) => n.type === 'Text')
    .map((n: any) => (Array.isArray(n.children) ? n.children.join('') : String(n.children || '')));
}

describe('TasksScreen Connection Mode Selector (#362)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useConfigStore.setState({ connectionMode: 'server' });
  });

  it('renders task list and displays connection mode badges', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<TasksScreen />);
    });

    const texts = findTexts(component.root);
    expect(texts.some((t) => t.includes('Daily News Digest'))).toBe(true);
    expect(texts.some((t) => t.includes('local'))).toBe(true);
    expect(texts.some((t) => t.includes('default'))).toBe(true);
  });

  it('opens create modal with App default selected and displays mode options', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<TasksScreen />);
    });

    // Press "+ Add Task" button
    const newBtn = component.root.find(
      (n: any) => n.props?.label === '+ Add Task' || (n.type === 'Text' && n.children?.includes('+ Add Task'))
    );

    await act(async () => {
      if (newBtn.props.onPress) {
        newBtn.props.onPress();
      } else {
        newBtn.parent.props.onPress();
      }
    });

    const texts = findTexts(component.root);
    expect(texts.some((t) => t.includes('Connection Mode'))).toBe(true);
    expect(texts.some((t) => t.includes('App default'))).toBe(true);
    expect(texts.some((t) => t.includes('Server'))).toBe(true);
    expect(texts.some((t) => t.includes('Local'))).toBe(true);
    expect(texts.some((t) => t.includes('Cloud'))).toBe(true);
    expect(texts.some((t) => t.includes('Inherits app mode (server)'))).toBe(true);
  });

  it('persists selected connection mode when creating a task', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<TasksScreen />);
    });

    // Open form
    const newBtn = component.root.find(
      (n: any) => n.props?.label === '+ Add Task' || (n.type === 'Text' && n.children?.includes('+ Add Task'))
    );
    await act(async () => {
      if (newBtn.props.onPress) {
        newBtn.props.onPress();
      } else {
        newBtn.parent.props.onPress();
      }
    });

    // Fill title and prompt
    const textInputs = component.root.findAllByType('TextInput' as any);
    const titleInput = textInputs.find((i: any) => i.props.placeholder?.includes('Title') || i.props.value === '');
    const promptInput = textInputs.find((i: any) => i.props.placeholder?.includes('instructions'));

    await act(async () => {
      titleInput?.props.onChangeText('Test Cloud Task');
      promptInput?.props.onChangeText('Run on cloud');
    });

    // Select "Cloud" pill
    await act(async () => {
      pressText(component.root, 'Cloud');
    });

    // Press "Save Task"
    const saveBtn = component.root.find(
      (n: any) => n.props?.label === 'Save Task' || (n.type === 'Text' && n.children?.includes('Save Task'))
    );
    await act(async () => {
      if (saveBtn.props.onPress) {
        saveBtn.props.onPress();
      } else {
        saveBtn.parent.props.onPress();
      }
    });

    expect(mockInsert).toHaveBeenCalled();
    const insertedValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.title).toBe('Test Cloud Task');
    expect(insertedValues.connection_mode).toBe('cloud');
  });

  it('persists null connection_mode when App default is selected', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<TasksScreen />);
    });

    // Open form
    const newBtn = component.root.find(
      (n: any) => n.props?.label === '+ Add Task' || (n.type === 'Text' && n.children?.includes('+ Add Task'))
    );
    await act(async () => {
      if (newBtn.props.onPress) {
        newBtn.props.onPress();
      } else {
        newBtn.parent.props.onPress();
      }
    });

    // Fill title and prompt
    const textInputs = component.root.findAllByType('TextInput' as any);
    const titleInput = textInputs[0];
    const promptInput = textInputs.find((i: any) => i.props.placeholder?.includes('instructions'));

    await act(async () => {
      titleInput?.props.onChangeText('App Default Task');
      promptInput?.props.onChangeText('Default prompt');
    });

    // Save with default selection (App default is initially selected)
    const saveBtn = component.root.find(
      (n: any) => n.props?.label === 'Save Task' || (n.type === 'Text' && n.children?.includes('Save Task'))
    );
    await act(async () => {
      if (saveBtn.props.onPress) {
        saveBtn.props.onPress();
      } else {
        saveBtn.parent.props.onPress();
      }
    });

    expect(mockInsert).toHaveBeenCalled();
    const insertedValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.connection_mode).toBeNull();
  });

  it('surfaces failure reason in task run history detail view (#363)', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<TasksScreen />);
    });

    // Click first task to open details modal
    await act(async () => {
      pressText(component.root, 'Daily News Digest');
    });

    const texts = findTexts(component.root);
    expect(texts.some((t) => t.includes('Execution Run History'))).toBe(true);
    expect(texts.some((t) => t.includes('FAILED'))).toBe(true);
    expect(texts.some((t) => t.includes('FAILURE REASON'))).toBe(true);
    expect(texts.some((t) => t.includes('Mode "cloud" not configured: no cloud provider key'))).toBe(true);
  });
});
