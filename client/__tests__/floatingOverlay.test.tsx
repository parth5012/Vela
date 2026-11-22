jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

jest.mock('../db/chatRepository', () => ({
  saveThread: jest.fn(async () => {}),
  saveThreads: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {}),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: jest.fn(async () => {}),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('../db/agentRepository', () => ({
  getCachedAgents: jest.fn(() => []),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('../hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    state: {
      recording: false,
      elapsedMs: 0,
      levels: [],
      partialText: '',
      consentProvider: null,
      failure: null,
      canRetry: false,
    },
    isAvailable: true,
    start: jest.fn(),
    stopAndCommit: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
  }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore } from '../store/useChatStore';
import { QUICK_CHAT_THREAD_ID } from '../utils/quickChatSync';
import FloatingOverlayRoot from '../components/overlay/FloatingOverlayRoot';
import DismissDropZone from '../components/overlay/DismissDropZone';
import MiniChatPanel from '../components/overlay/MiniChatPanel';

describe('Floating Overlay UI Components (#596, #599)', () => {
  beforeEach(() => {
    useConfigStore.getState().clearConfig();
    useChatStore.getState().clearStore();
    jest.clearAllMocks();
  });

  describe('FloatingOverlayRoot', () => {
    it('renders null when floatingOverlay is disabled', () => {
      act(() => {
        useConfigStore.getState().setFloatingOverlayEnabled(false);
      });
      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(<FloatingOverlayRoot />);
      });
      expect(tree?.toJSON()).toBeNull();
    });

    it('renders FloatingBubble when floatingOverlay is enabled', () => {
      act(() => {
        useConfigStore.getState().setFloatingOverlayEnabled(true);
      });
      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(<FloatingOverlayRoot />);
      });
      const root = tree?.root;
      const bubble = root?.findByProps({ accessibilityLabel: 'Open Quick Chat floating overlay' });
      expect(bubble).toBeTruthy();
    });
  });

  describe('DismissDropZone', () => {
    it('returns null when visible is false', () => {
      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(<DismissDropZone visible={false} isHovered={false} />);
      });
      expect(tree?.toJSON()).toBeNull();
    });

    it('renders drop zone label when visible', () => {
      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(<DismissDropZone visible={true} isHovered={false} />);
      });
      const str = JSON.stringify(tree?.toJSON());
      expect(str).toContain('Drag here to close');
    });

    it('renders release label when hovered', () => {
      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(<DismissDropZone visible={true} isHovered={true} />);
      });
      const str = JSON.stringify(tree?.toJSON());
      expect(str).toContain('Release to close');
    });
  });

  describe('MiniChatPanel', () => {
    it('displays Quick Chat title and synced badge', () => {
      useChatStore.getState().addMessage(QUICK_CHAT_THREAD_ID, {
        id: 'msg-1',
        role: 'assistant',
        content: 'Welcome to Quick Chat',
      });

      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(
          <MiniChatPanel onMinimize={jest.fn()} onClose={jest.fn()} />
        );
      });

      const str = JSON.stringify(tree?.toJSON());
      expect(str).toContain('Quick Chat');
      expect(str).toContain('Synced');
      expect(str).toContain('Welcome to Quick Chat');
    });

    it('respects capability toggles for voice and image attachments', () => {
      useConfigStore.setState((s) => ({
        floatingOverlay: { ...s.floatingOverlay, enableVoice: false, enableImages: false },
      }));

      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(
          <MiniChatPanel onMinimize={jest.fn()} onClose={jest.fn()} />
        );
      });

      const root = tree?.root;
      const attachBtn = root?.findAllByProps({ accessibilityLabel: 'Attach image' }) ?? [];
      expect(attachBtn.length).toBe(0);

      const voiceBtn = root?.findAllByProps({ accessibilityLabel: 'Start voice recording' }) ?? [];
      expect(voiceBtn.length).toBe(0);
    });
  });
});
