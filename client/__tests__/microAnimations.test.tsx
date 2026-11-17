// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated, AccessibilityInfo } from 'react-native';
import SyncStatusIndicator from '../components/ui/SyncStatusIndicator';
import QueueBadge from '../components/ui/QueueBadge';
import ThreadRow from '../components/ui/ThreadRow';
import { useOfflineStore } from '../store/useOfflineStore';
import { useConfigStore } from '../store/useConfigStore';
import { EASING, DURATIONS } from '../utils/motion';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

describe('Micro-animations & Reduced Motion (WF-576)', () => {
  beforeEach(() => {
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

  describe('SyncStatusIndicator animations', () => {
    it('triggers press-in scale animation with native driver and ease-out curve', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let component: any;
      act(() => {
        component = renderer.create(<SyncStatusIndicator />);
      });

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

      timingSpy.mockRestore();
    });

    it('triggers status change animation on syncState update', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let component: any;
      act(() => {
        component = renderer.create(<SyncStatusIndicator />);
      });

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
  });

  describe('QueueBadge animations', () => {
    it('animates badge scale on count change and press feedback', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      act(() => {
        useOfflineStore.getState().setPendingQueueCount(3);
      });

      let component: any;
      act(() => {
        component = renderer.create(<QueueBadge />);
      });

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
  });

  describe('ThreadRow animations', () => {
    it('animates press-in and press-out scale on native driver', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      const mockThread = {
        id: 'thread-1',
        title: 'Test Thread',
        created_at: Date.now(),
        updated_at: Date.now(),
        is_pinned: false,
      };

      let component: any;
      act(() => {
        component = renderer.create(
          <ThreadRow
            thread={mockThread as any}
            isActive={false}
            streaming={false}
            colors={{ card: '#fff', glassBorder: '#ccc', textMuted: '#666', text: '#000', textDark: '#333' }}
            accentHex="#6366f1"
            onSelect={jest.fn()}
            onOpenOptions={jest.fn()}
          />
        );
      });

      const animatedPressable = component.root.findByProps({ delayLongPress: 450 });
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
  });
});
