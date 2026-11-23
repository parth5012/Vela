import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SyncConflictModal } from '../components/ui/SyncConflictModal';
import { useSyncConflictStore, type SyncConflict } from '../store/useSyncConflictStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

describe('SyncConflictModal', () => {
  const sampleConflict: SyncConflict = {
    id: 'conflict_abc_1',
    conversation_id: 'conv_1',
    localMessage: {
      id: 'conflict_abc_1',
      role: 'user',
      content: 'Local text edited while offline',
      created_at: 1000,
      provider: 'android_client',
      conversation_id: 'conv_1',
    },
    serverMessage: {
      id: 'conflict_abc_1',
      role: 'user',
      content: 'Server text from remote',
      created_at: 2000,
      provider: 'remote',
      conversation_id: 'conv_1',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useSyncConflictStore.getState().clearConflicts();
    });
  });

  it('renders null when there are no conflicts', () => {
    let component: any;
    act(() => {
      component = renderer.create(<SyncConflictModal />);
    });
    expect(component.toJSON()).toBeNull();
  });

  it('renders modal with conflict cards when conflicts exist', () => {
    act(() => {
      useSyncConflictStore.getState().addConflict(sampleConflict);
    });

    let component: any;
    act(() => {
      component = renderer.create(<SyncConflictModal />);
    });

    const root = component.root;
    expect(root.findByProps({ testID: 'sync-conflict-modal' })).toBeDefined();
    expect(root.findByProps({ testID: 'conflict-card-conflict_abc_1' })).toBeDefined();

    // Verify both local and server previews are rendered
    const textNodes = root.findAllByType('Text');
    const texts = textNodes.map((n: any) => n.props.children).flat();
    expect(texts).toContain('Local text edited while offline');
    expect(texts).toContain('Server text from remote');
  });

  it('calls resolveConflict with "local" when Keep Local button is pressed', () => {
    const resolveSpy = jest.spyOn(useSyncConflictStore.getState(), 'resolveConflict');

    act(() => {
      useSyncConflictStore.getState().addConflict(sampleConflict);
    });

    let component: any;
    act(() => {
      component = renderer.create(<SyncConflictModal />);
    });

    const keepLocalBtn = component.root.findByProps({ testID: 'conflict-keep-local-conflict_abc_1' });
    act(() => {
      keepLocalBtn.props.onPress();
    });

    expect(resolveSpy).toHaveBeenCalledWith('conflict_abc_1', 'local');
  });

  it('calls resolveConflict with "server" when Keep Server button is pressed', () => {
    const resolveSpy = jest.spyOn(useSyncConflictStore.getState(), 'resolveConflict');

    act(() => {
      useSyncConflictStore.getState().addConflict(sampleConflict);
    });

    let component: any;
    act(() => {
      component = renderer.create(<SyncConflictModal />);
    });

    const keepServerBtn = component.root.findByProps({ testID: 'conflict-keep-server-conflict_abc_1' });
    act(() => {
      keepServerBtn.props.onPress();
    });

    expect(resolveSpy).toHaveBeenCalledWith('conflict_abc_1', 'server');
  });

  it('calls resolveConflict with "both" when Keep Both button is pressed', () => {
    const resolveSpy = jest.spyOn(useSyncConflictStore.getState(), 'resolveConflict');

    act(() => {
      useSyncConflictStore.getState().addConflict(sampleConflict);
    });

    let component: any;
    act(() => {
      component = renderer.create(<SyncConflictModal />);
    });

    const keepBothBtn = component.root.findByProps({ testID: 'conflict-keep-both-conflict_abc_1' });
    act(() => {
      keepBothBtn.props.onPress();
    });

    expect(resolveSpy).toHaveBeenCalledWith('conflict_abc_1', 'both');
  });
});
