import React from 'react';
import { Animated } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { AccentDotItem, AccentDots } from '../components/ui/settingsKit';
import MessageOptionsModal from '../components/ui/MessageOptionsModal';
import * as reducedMotionHook from '../hooks/useReducedMotion';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => '/',
}));

jest.mock('../utils/perfTracker', () => ({
  perfTracker: {
    startTrace: jest.fn(),
    endTrace: jest.fn(),
  },
}));

describe('Modals & Settings Motion Micro-interactions', () => {
  const dummyColors = {
    card: '#0f172a',
    border: '#1e293b',
    text: '#f8fafc',
    textDark: '#475569',
    background: '#0b1329',
    bubbleUser: '#14b8a6',
    bubbleAssistant: '#1e293b',
    textMuted: '#94a3b8',
    inputBackground: '#1e293b',
    iconDefault: '#94a3b8',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('AccentDotItem Selection Pop', () => {
    it('fires a spring animation with native driver when accent is selected', () => {
      const springSpy = jest.spyOn(Animated, 'spring');
      let tree: renderer.ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <AccentDotItem
            color="emerald"
            selected={false}
            auroraAcc1="#14b8a6"
            onPress={jest.fn()}
          />
        );
      });

      // Switch to selected
      act(() => {
        tree.update(
          <AccentDotItem
            color="emerald"
            selected={true}
            auroraAcc1="#14b8a6"
            onPress={jest.fn()}
          />
        );
      });

      const nativeDriverCalls = springSpy.mock.calls.filter(
        (call) => call[1]?.useNativeDriver === true
      );
      expect(nativeDriverCalls.length).toBeGreaterThan(0);

      act(() => {
        tree!.unmount();
      });
    });

    it('bypasses spring animation under reduced motion', () => {
      jest.spyOn(reducedMotionHook, 'useReducedMotion').mockReturnValue(true);
      const springSpy = jest.spyOn(Animated, 'spring');

      let tree: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <AccentDotItem
            color="emerald"
            selected={false}
            auroraAcc1="#14b8a6"
            onPress={jest.fn()}
          />
        );
      });

      act(() => {
        tree.update(
          <AccentDotItem
            color="emerald"
            selected={true}
            auroraAcc1="#14b8a6"
            onPress={jest.fn()}
          />
        );
      });

      expect(springSpy).not.toHaveBeenCalled();

      act(() => {
        tree!.unmount();
      });
    });
  });

  describe('MessageOptionsModal Tactile Buttons', () => {
    it('renders options with PressableScale for tactile feedback', () => {
      let tree: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <MessageOptionsModal
            visible={true}
            onClose={jest.fn()}
            onDownloadMd={jest.fn()}
            onRegenerate={jest.fn()}
            onToggleRaw={jest.fn()}
            onBranch={jest.fn()}
            onCopyText={jest.fn()}
            onCopyCode={jest.fn()}
            onShare={jest.fn()}
            onShowInfo={jest.fn()}
            themeColors={dummyColors as any}
            isRaw={false}
            isUser={false}
          />
        );
      });

      const root = tree!.root;
      const downloadBtn = root.findByProps({ accessibilityLabel: 'Download as MD' });
      // PressableScale has scaleTo prop
      expect(downloadBtn.props.scaleTo).toBe(0.97);

      const cancelBtn = root.findByProps({ accessibilityLabel: 'Cancel' });
      expect(cancelBtn.props.scaleTo).toBe(0.96);

      act(() => {
        tree!.unmount();
      });
    });

    it('animates bottom sheet entrance translateY and backdrop fade with native driver', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let tree: renderer.ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <MessageOptionsModal
            visible={true}
            onClose={jest.fn()}
            onDownloadMd={jest.fn()}
            onRegenerate={jest.fn()}
            onToggleRaw={jest.fn()}
            onBranch={jest.fn()}
            onCopyText={jest.fn()}
            onCopyCode={jest.fn()}
            onShare={jest.fn()}
            onShowInfo={jest.fn()}
            themeColors={dummyColors as any}
            isRaw={false}
            isUser={false}
          />
        );
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const sheetCall = calls.find((c: any) => c && c.toValue === 0 && c.useNativeDriver === true);
      expect(sheetCall).toBeDefined();

      const overlayCall = calls.find((c: any) => c && c.toValue === 1 && c.useNativeDriver === true);
      expect(overlayCall).toBeDefined();

      act(() => {
        tree!.unmount();
      });
    });
  });
});
