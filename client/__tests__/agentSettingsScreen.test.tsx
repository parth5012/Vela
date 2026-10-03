import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AgentScreen from '../app/settings/agent';
import { useConfigStore } from '../store/useConfigStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

const mockInsertAgent = jest.fn(async () => null);
const mockUpdateAgent = jest.fn(async () => null);
const mockDeleteAgent = jest.fn(async () => true);
const mockDuplicateAgent = jest.fn(async () => null);

let mockAgents = [
  { id: 'personal assistant', name: 'Personal Assistant', description: 'Warm assistant.', icon: '🤖', is_preset: true, system_prompt: 'You are helpful.' },
  { id: 'custom-one', name: 'Custom One', description: 'My agent.', icon: '🦊', is_preset: false, system_prompt: 'Custom prompt.' },
];

jest.mock('../db/agentRepository', () => ({
  getCachedAgents: () => mockAgents,
  subscribeAgents: () => () => {},
  refreshAgents: jest.fn(async () => mockAgents),
  insertAgent: (...args: any[]) => (mockInsertAgent as any)(...args),
  updateAgent: (...args: any[]) => (mockUpdateAgent as any)(...args),
  deleteAgent: (...args: any[]) => (mockDeleteAgent as any)(...args),
  duplicateAgent: (...args: any[]) => (mockDuplicateAgent as any)(...args),
}));

function pressRow(root: any, id: string) {
  const row = root.findAllByProps({ testID: `agent-row-${id}` })[0];
  act(() => {
    row.props.onPress();
  });
}

function pressText(root: any, text: string) {
  let node = root.findAll(
    (n: any) => n.type === 'Text' && n.children.join('').includes(text)
  )[0];
  while (node && !node.props.onPress) node = node.parent;
  act(() => {
    node.props.onPress();
  });
}

function findByA11y(root: any, label: string) {
  return root.findAll(
    (n: any) => n.props.accessibilityLabel === label
  )[0];
}

describe('Agent settings screen', () => {
  beforeEach(() => {
    mockInsertAgent.mockClear();
    mockUpdateAgent.mockClear();
    mockDeleteAgent.mockClear();
    mockDuplicateAgent.mockClear();
    useConfigStore.getState().clearConfig();
    useConfigStore.setState({ connectionMode: 'server' });
  });

  async function render() {
    let component: any;
    await act(async () => {
      component = renderer.create(<AgentScreen />);
      await Promise.resolve();
    });
    return component;
  }

  it('has no global systemPrompt input', async () => {
    const component = await render();
    const inputs = component.root.findAllByType('TextInput');
    const promptInputs = inputs.filter((i: any) =>
      String(i.props.placeholder ?? '').includes('autonomous research agent')
    );
    expect(promptInputs).toHaveLength(0);
    act(() => component.unmount());
  });

  it('lists agents with icon, name, description', async () => {
    const component = await render();
    const joined = component.root
      .findAllByType('Text')
      .map((t: any) => t.props.children)
      .flat(Infinity)
      .join(' ');
    expect(joined).toContain('Personal Assistant');
    expect(joined).toContain('Warm assistant.');
    expect(joined).toContain('Custom One');
    expect(joined).toContain('🤖');
    act(() => component.unmount());
  });

  it('preset agent shows only Duplicate', async () => {
    const component = await render();
    pressRow(component.root, 'personal assistant');
    expect(findByA11y(component.root, 'Duplicate Personal Assistant')).toBeTruthy();
    expect(findByA11y(component.root, 'Edit Personal Assistant')).toBeFalsy();
    expect(findByA11y(component.root, 'Delete Personal Assistant')).toBeFalsy();
    act(() => component.unmount());
  });

  it('custom agent shows Edit and Delete', async () => {
    const component = await render();
    pressRow(component.root, 'custom-one');
    expect(findByA11y(component.root, 'Edit Custom One')).toBeTruthy();
    expect(findByA11y(component.root, 'Delete Custom One')).toBeTruthy();
    const joined = component.root
      .findAllByType('Text')
      .map((t: any) => t.props.children)
      .flat(Infinity)
      .join(' ');
    expect(joined).toContain('Custom prompt.');
    act(() => component.unmount());
  });

  it('delete asks for confirmation and calls deleteAgent', async () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert');
    const component = await render();
    pressRow(component.root, 'custom-one');
    act(() => {
      findByA11y(component.root, 'Delete Custom One').props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete agent?',
      expect.any(String),
      expect.any(Array)
    );
    const buttons = alertSpy.mock.calls[0][2] as any;
    act(() => {
      buttons.find((b: any) => b.text === 'Delete').onPress();
    });
    expect(mockDeleteAgent).toHaveBeenCalledWith('custom-one');
    act(() => component.unmount());
  });

  it('duplicate calls duplicateAgent', async () => {
    const component = await render();
    pressRow(component.root, 'personal assistant');
    act(() => {
      findByA11y(component.root, 'Duplicate Personal Assistant').props.onPress();
    });
    expect(mockDuplicateAgent).toHaveBeenCalledWith('personal assistant');
    act(() => component.unmount());
  });

  it('model field in agent form is disabled unless cloud mode', async () => {
    useConfigStore.setState({ connectionMode: 'local' });
    const component = await render();
    pressRow(component.root, 'custom-one');
    act(() => {
      findByA11y(component.root, 'Edit Custom One').props.onPress();
    });
    const modelInput = component.root
      .findAllByType('TextInput')
      .find((i: any) => String(i.props.placeholder ?? '').includes('managed by connection mode'));
    expect(modelInput.props.editable).toBe(false);
    const joined = component.root
      .findAllByType('Text')
      .map((t: any) => t.props.children)
      .flat(Infinity)
      .join(' ');
    expect(joined).toContain('Local mode: the model is chosen globally');
    act(() => component.unmount());
  });

  it('model field is editable in cloud mode', async () => {
    useConfigStore.setState({ connectionMode: 'cloud' });
    const component = await render();
    pressRow(component.root, 'custom-one');
    act(() => {
      findByA11y(component.root, 'Edit Custom One').props.onPress();
    });
    const modelInput = component.root
      .findAllByType('TextInput')
      .find((i: any) => String(i.props.placeholder ?? '').includes('inherit provider default'));
    expect(modelInput.props.editable).not.toBe(false);
    act(() => component.unmount());
  });

  it('new agent form inserts a custom agent', async () => {
    const component = await render();
    pressText(component.root, '+ New agent');
    const inputs = component.root.findAllByType('TextInput');
    const nameInput = inputs.find((i: any) => i.props.placeholder === 'Agent name');
    act(() => {
      nameInput.props.onChangeText('Researcher');
    });
    act(() => {
      findByA11y(component.root, 'Create').props.onPress();
    });
    expect(mockInsertAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Researcher', is_preset: false })
    );
    act(() => component.unmount());
  });

  it('default agent PillGroup lists all agents from the hook', async () => {
    const component = await render();
    const joined = component.root
      .findAllByType('Text')
      .map((t: any) => t.props.children)
      .flat(Infinity)
      .join(' ');
    expect(joined).toContain('Custom One');
    act(() => component.unmount());
  });
});
