import React from 'react';
import renderer, { act } from 'react-test-renderer';
import CloudProvidersScreen from '../app/settings/cloud-providers';
import ConnectionScreen from '../app/settings/connection';
import { useConfigStore } from '../store/useConfigStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
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

jest.mock('../utils/providers/models', () => ({
  fetchProviderModels: jest.fn(async () => ['model-1', 'model-2']),
  testProviderConnection: jest.fn(async () => ({ ok: true, message: 'Connected' })),
  getCuratedModels: jest.fn(() => ['model-1']),
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

describe('Cloud Providers and Connection Settings Screens', () => {
  beforeEach(() => {
    mockPush.mockClear();
    useConfigStore.getState().clearConfig();
  });

  it('renders CloudProvidersScreen with all 6 provider cards', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<CloudProvidersScreen />);
      await Promise.resolve();
    });

    const root = component.root;
    const texts = root.findAllByType('Text').map((t) => t.props.children);
    const joined = texts.flat(Infinity).join(' ');

    expect(joined).toContain('Google Gemini');
    expect(joined).toContain('OpenAI');
    expect(joined).toContain('Anthropic Claude');
    expect(joined).toContain('OpenRouter');
    expect(joined).toContain('Groq');
    expect(joined).toContain('Custom (OpenAI-Compatible)');

    act(() => {
      component.unmount();
    });
  });

  it('renders ConnectionScreen with mode selector and switches connection mode', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<ConnectionScreen />);
      await Promise.resolve();
    });

    expect(useConfigStore.getState().connectionMode).toBe('server');

    act(() => {
      useConfigStore.getState().setConnectionMode('cloud');
    });

    expect(useConfigStore.getState().connectionMode).toBe('cloud');

    act(() => {
      component.unmount();
    });
  });
});
