import React from 'react';
import { Animated } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import SendStopButton from '../components/chat/SendStopButton';
import AttachmentPickerTray from '../components/chat/AttachmentPickerTray';
import * as reducedMotionHook from '../hooks/useReducedMotion';

jest.mock('../utils/perfTracker', () => ({
  perfTracker: {
    startTrace: jest.fn(),
    endTrace: jest.fn(),
  },
}));

describe('Chat Controls Motion & Micro-interactions', () => {
  const dummyAurora = {
    acc1: '#14b8a6',
    acc2: '#06b6d4',
    glow: '#0d9488',
    onAccent: '#042f2e',
  };

  const dummyColors = {
    card: '#0f172a',
    border: '#1e293b',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    glassBorder: '#334155',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('SendStopButton', () => {
    it('configures native driver and ease-out curves on morph animation', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let tree: renderer.ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <SendStopButton
            isStreaming={false}
            canSend={true}
            onPress={jest.fn()}
            aurora={dummyAurora}
          />
        );
      });

      // Toggle streaming to trigger morph
      act(() => {
        tree.update(
          <SendStopButton
            isStreaming={true}
            canSend={true}
            onPress={jest.fn()}
            aurora={dummyAurora}
          />
        );
      });

      const nativeDriverCalls = timingSpy.mock.calls.filter(
        (call) => call[1]?.useNativeDriver === true
      );
      expect(nativeDriverCalls.length).toBeGreaterThan(0);

      // Verify timing duration capped at 200ms for morph
      const morphCall = timingSpy.mock.calls.find((call) => call[1]?.duration === 200);
      expect(morphCall).toBeDefined();
      expect(morphCall![1].useNativeDriver).toBe(true);

      act(() => {
        tree!.unmount();
      });
    });

    it('suppresses continuous pulse loop under reduced motion', () => {
      jest.spyOn(reducedMotionHook, 'useReducedMotion').mockReturnValue(true);
      const loopSpy = jest.spyOn(Animated, 'loop');

      let tree: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <SendStopButton
            isStreaming={true}
            canSend={false}
            onPress={jest.fn()}
            aurora={dummyAurora}
          />
        );
      });

      expect(loopSpy).not.toHaveBeenCalled();
      act(() => {
        tree!.unmount();
      });
    });

    it('sets correct accessibility props for send and stop states', () => {
      let tree: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <SendStopButton
            isStreaming={false}
            canSend={true}
            onPress={jest.fn()}
            aurora={dummyAurora}
          />
        );
      });

      const root = tree!.root;
      const sendButton = root.findByProps({ accessibilityLabel: 'Send message' });
      expect(sendButton.props.accessibilityRole).toBe('button');
      expect(sendButton.props.accessibilityState.busy).toBe(false);

      // Transition to streaming
      act(() => {
        tree.update(
          <SendStopButton
            isStreaming={true}
            canSend={true}
            onPress={jest.fn()}
            aurora={dummyAurora}
          />
        );
      });

      const stopButton = root.findByProps({ accessibilityLabel: 'Stop generating' });
      expect(stopButton.props.accessibilityState.busy).toBe(true);

      act(() => {
        tree!.unmount();
      });
    });
  });

  describe('AttachmentPickerTray Entrance', () => {
    it('animates attachment cards on mount with native driver', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let tree: renderer.ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <AttachmentPickerTray
            attachments={[
              {
                uri: 'file:///test-1.jpg',
                name: 'test-1.jpg',
                size: 1024,
                mimeType: 'image/jpeg',
              },
            ]}
            onRemove={jest.fn()}
            onUpdateAltText={jest.fn()}
            maxCount={5}
            colors={dummyColors}
            accentColor="#14b8a6"
          />
        );
      });

      const entranceCalls = timingSpy.mock.calls.filter(
        (call) => call[1]?.duration === 200 && call[1]?.useNativeDriver === true
      );
      expect(entranceCalls.length).toBeGreaterThan(0);

      act(() => {
        tree!.unmount();
      });
    });
  });
});
