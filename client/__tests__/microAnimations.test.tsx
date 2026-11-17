// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import SyncStatusIndicator from '../components/ui/SyncStatusIndicator';
import QueueBadge from '../components/ui/QueueBadge';
import ThreadRow from '../components/ui/ThreadRow';
import { useOfflineStore } from '../store/useOfflineStore';
import { useConfigStore } from '../store/useConfigStore';
import { EASING, DURATIONS } from '../utils/motion';

let mockReducedMotion = false;
jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

describe('Micro-animations & Reduced Motion (WF-576)', () => {
  const roots: any[] = [];
  const render = (element: React.ReactElement) => {
    let root: any;
    act(() => {
      root = renderer.create(element);
    });
    roots.push(root);
    return root;
  };

  beforeEach(() => {
    mockReducedMotion = false;
    act(() => {
      useOfflineStore.getState().reset();
      useConfigStore.setState({
        theme: 'berry',
        accentColor: 'indigo',
        isConfigured: true,
        apiUrl: 'https://test-node.vela.ai',
      });
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount());
    });
    jest.restoreAllMocks();
  });

  describe('SyncStatusIndicator animations', () => {
    it('triggers press-in scale animation with native driver and ease-out curve', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      const component: any = render(
        <SyncStatusIndicator />
      );

      const pressable = component.root.findByProps({ testID: 'sync-status-indicator' });
      act(() => {
        pressable.props.onPressIn?.();
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const pressCall = calls.find((c: any) => c && c.toValue === 0.95);
      expect(pressCall).toBeDefined();
      expect(pressCall.useNativeDriver).toBe(true);
      expect(pressCall.easing).toBe(EASING.out);
      expect(pressCall.duration).toBe(DURATIONS.press);

      act(() => {
        pressable.props.onPressOut?.();
      });
      const releaseCall = timingSpy.mock.calls
        .map((c) => c[1])
        .find((c: any) => c && c.toValue === 1);
      expect(releaseCall).toBeDefined();

      timingSpy.mockRestore();
    });

    it('triggers status change animation on syncState update', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      const component: any = render(
        <SyncStatusIndicator />
      );

      act(() => {
        useOfflineStore.getState().setSyncState('offline');
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const pulseCall = calls.find((c: any) => c && c.toValue === 1.25);
      expect(pulseCall).toBeDefined();
      expect(pulseCall.useNativeDriver).toBe(true);
      expect(pulseCall.duration).toBe(DURATIONS.press);

      timingSpy.mockRestore();
    });

    it('uses opacity fallback for press and updates when reduced motion is enabled', () => {
      mockReducedMotion = true;
      const timingSpy = jest.spyOn(Animated, 'timing');

      const component: any = render(
        <SyncStatusIndicator />
      );

      const pressable = component.root.findByProps({ testID: 'sync-status-indicator' });
      act(() => {
        pressable.props.onPressIn?.();
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const pressOpacityCall = calls.find((c: any) => c && c.toValue === 0.6);
      expect(pressOpacityCall).toBeDefined();
      expect(pressOpacityCall.useNativeDriver).toBe(true);

      expect(pressable.props.accessibilityHint).toBe(
        'Displays sync connection details and allows triggering manual sync'
      );

      timingSpy.mockRestore();
    });
  });

  describe('QueueBadge animations', () => {
    it('animates badge scale on count change and press feedback', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      act(() => {
        useOfflineStore.getState().setPendingQueueCount(3);
      });

      const component: any = render(
        <QueueBadge />
      );

      const badge = component.root.findByProps({ testID: 'queue-badge' });
      act(() => {
        badge.props.onPressIn?.();
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const pressCall = calls.find((c: any) => c && c.toValue === 0.95);
      expect(pressCall).toBeDefined();
      expect(pressCall.useNativeDriver).toBe(true);
      expect(pressCall.duration).toBe(DURATIONS.press);

      timingSpy.mockRestore();
    });

    it('falls back to opacity animation under reduced motion and sets disabled state when syncing', () => {
      mockReducedMotion = true;
      const timingSpy = jest.spyOn(Animated, 'timing');

      act(() => {
        useOfflineStore.getState().setPendingQueueCount(2);
      });

      const component: any = render(
        <QueueBadge />
      );

      const badge = component.root.findByProps({ testID: 'queue-badge' });
      act(() => {
        badge.props.onPressIn?.();
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const pressOpacityCall = calls.find((c: any) => c && c.toValue === 0.7);
      expect(pressOpacityCall).toBeDefined();

      // Setting sync state to syncing disables badge
      act(() => {
        useOfflineStore.getState().setSyncState('syncing');
      });

      const updatedBadge = component.root.findByProps({ testID: 'queue-badge' });
      expect(updatedBadge.props.disabled).toBe(true);
      expect(updatedBadge.props.accessibilityState.disabled).toBe(true);

      timingSpy.mockRestore();
    });
  });

  describe('ThreadRow animations', () => {
    const mockThread = {
      id: 'thread-1',
      title: 'Test Thread',
      created_at: Date.now(),
      updated_at: Date.now(),
      is_pinned: true,
    };

    it('animates press-in and press-out scale on native driver', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');

      const component: any = render(
          <ThreadRow
            thread={mockThread as any}
            isActive={true}
            streaming={false}
            colors={{ card: '#fff', glassBorder: '#ccc', textMuted: '#666', text: '#000', textDark: '#333' }}
            accentHex="#6366f1"
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
      );

      const animatedPressable = component.root.findByProps({ delayLongPress: 450 });
      expect(animatedPressable.props.accessibilityRole).toBe('button');
      expect(animatedPressable.props.accessibilityState).toEqual({ selected: true });
      expect(animatedPressable.props.accessibilityLabel).toContain('Test Thread');
      expect(animatedPressable.props.accessibilityLabel).toContain('pinned');

      act(() => {
        animatedPressable.props.onPressIn?.();
      });

      let calls = timingSpy.mock.calls.map((c) => c[1]);
      const pressInCall = calls.find((c: any) => c && c.toValue === 0.98);
      expect(pressInCall).toBeDefined();
      expect(pressInCall.useNativeDriver).toBe(true);
      expect(pressInCall.duration).toBe(DURATIONS.press);

      act(() => {
        animatedPressable.props.onPressOut?.();
      });

      calls = timingSpy.mock.calls.map((c) => c[1]);
      const pressOutCall = calls.find((c: any) => c && c.toValue === 1);
      expect(pressOutCall).toBeDefined();
      expect(pressOutCall.useNativeDriver).toBe(true);

      timingSpy.mockRestore();
    });

    it('starts pulsing loop when streaming is true, but suppresses loop under reduced motion', () => {
      const loopSpy = jest.spyOn(Animated, 'loop');

      const component: any = render(
          <ThreadRow
            thread={mockThread as any}
            isActive={false}
            streaming={true}
            colors={{ card: '#fff', glassBorder: '#ccc', textMuted: '#666', text: '#000', textDark: '#333' }}
            accentHex="#6366f1"
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
      );

      expect(loopSpy).toHaveBeenCalled();
      loopSpy.mockClear();

      // Now with reduced motion
      mockReducedMotion = true;
      const reducedComponent: any = render(
          <ThreadRow
            thread={mockThread as any}
            isActive={false}
            streaming={true}
            colors={{ card: '#fff', glassBorder: '#ccc', textMuted: '#666', text: '#000', textDark: '#333' }}
            accentHex="#6366f1"
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
      );

      // Loop should NOT have been started under reduced motion
      expect(loopSpy).not.toHaveBeenCalled();

      loopSpy.mockRestore();
    });
  });
});
