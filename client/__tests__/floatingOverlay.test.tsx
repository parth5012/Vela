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

const mockStopVoice = jest.fn();
const mockStartVoice = jest.fn();
const mockCancelVoice = jest.fn();

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
    start: mockStartVoice,
    stop: mockStopVoice,
    cancel: mockCancelVoice,
    acceptCloud: jest.fn(),
    declineCloud: jest.fn(),
    retry: jest.fn(),
  }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore } from '../store/useChatStore';
import { QUICK_CHAT_THREAD_ID } from '../utils/quickChatSync';
import { streamController } from '../utils/streamController';
import FloatingOverlayRoot from '../components/overlay/FloatingOverlayRoot';
import FloatingBubble from '../components/overlay/FloatingBubble';
import DismissDropZone from '../components/overlay/DismissDropZone';
import MiniChatPanel from '../components/overlay/MiniChatPanel';

describe('Floating Overlay UI Components (#596, #599)', () => {
  beforeEach(() => {
    act(() => {
      useConfigStore.getState().clearConfig();
      useChatStore.getState().clearStore();
    });
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
      act(() => {
        useConfigStore.setState((s) => ({
          floatingOverlay: { ...s.floatingOverlay, enableVoice: false, enableImages: false },
        }));
      });

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

    it('renders stop button when thread is streaming and allows stopping', () => {
      act(() => {
        useChatStore.getState().setStreamingThread(QUICK_CHAT_THREAD_ID, true);
      });

      const stopSpy = jest.spyOn(streamController, 'stopStream').mockResolvedValue(undefined as never);

      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(
          <MiniChatPanel onMinimize={jest.fn()} onClose={jest.fn()} />
        );
      });

      const root = tree?.root;
      const stopBtn = root?.findByProps({ accessibilityLabel: 'Stop generating response' });
      expect(stopBtn).toBeTruthy();

      act(() => {
        stopBtn!.props.onPress();
      });

      expect(stopSpy).toHaveBeenCalledWith(QUICK_CHAT_THREAD_ID);
      stopSpy.mockRestore();
    });

    it('renders attachment previews in sent messages', () => {
      act(() => {
        useChatStore.getState().addMessage(QUICK_CHAT_THREAD_ID, {
          id: 'msg-img',
          role: 'user',
          content: '',
          attachments: [
            {
              storage_path: 'file:///photo.jpg',
              mime_type: 'image/jpeg',
              file_size: 1024,
              alt_text: 'Dashboard Preview',
            },
          ],
        });
      });

      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(
          <MiniChatPanel onMinimize={jest.fn()} onClose={jest.fn()} />
        );
      });

      const str = JSON.stringify(tree?.toJSON());
      expect(str).toContain('Dashboard Preview');
    });
  });

  describe('FloatingBubble', () => {
    it('supports accessibility activate action to trigger expand', () => {
      const onExpand = jest.fn();
      let tree: renderer.ReactTestRenderer | undefined;
      act(() => {
        tree = renderer.create(
          <FloatingBubble onExpand={onExpand} onDismiss={jest.fn()} onDragStateChange={jest.fn()} />
        );
      });

      const root = tree?.root;
      const bubble = root?.findByProps({ accessibilityLabel: 'Open Quick Chat floating overlay' });
      expect(bubble).toBeTruthy();

      act(() => {
        bubble!.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
      });

      expect(onExpand).toHaveBeenCalledTimes(1);
    });
  });
});
