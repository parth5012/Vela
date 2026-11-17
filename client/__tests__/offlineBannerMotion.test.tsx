// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import OfflineBanner from '../components/ui/OfflineBanner';
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
    navigate: jest.fn(),
  }),
  useSegments: () => [''],
  useRootNavigationState: () => ({ key: 'root' }),
  Slot: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 30, bottom: 0, left: 0, right: 0 }),
}));

describe('OfflineBanner & Route Toggle Motion', () => {
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

  describe('OfflineBanner Motion & Reduced Motion', () => {
    it('renders null when app is online', () => {
      let component: any;
      act(() => {
        component = renderer.create(<OfflineBanner />);
      });
      expect(component.toJSON()).toBeNull();
    });

    it('animates translateY and opacity entrance with native driver when going offline', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let component: any;

      act(() => {
        useOfflineStore.getState().setOnline(false);
        component = renderer.create(<OfflineBanner />);
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const translateYCall = calls.find((c: any) => c && c.toValue === 0);
      expect(translateYCall).toBeDefined();
      expect(translateYCall.useNativeDriver).toBe(true);
      expect(translateYCall.easing).toBe(EASING.out);
      expect(translateYCall.duration).toBe(DURATIONS.reveal);

      const opacityCall = calls.find((c: any) => c && c.toValue === 1);
      expect(opacityCall).toBeDefined();
      expect(opacityCall.useNativeDriver).toBe(true);

      timingSpy.mockRestore();
    });

    it('falls back to opacity-only entrance when reduced motion is enabled', () => {
      mockReducedMotion = true;
      const timingSpy = jest.spyOn(Animated, 'timing');
      let component: any;

      act(() => {
        useOfflineStore.getState().setOnline(false);
        component = renderer.create(<OfflineBanner />);
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const opacityCall = calls.find((c: any) => c && c.toValue === 1);
      expect(opacityCall).toBeDefined();
      expect(opacityCall.useNativeDriver).toBe(true);

      // translateY should NOT be animated under reduced motion
      const translateYCall = calls.find((c: any) => c && c.toValue === 0 && c.duration === DURATIONS.reveal);
      expect(translateYCall).toBeUndefined();

      timingSpy.mockRestore();
    });

    it('animates exit transition with native driver when coming back online', async () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      let component: any;

      act(() => {
        useOfflineStore.getState().setOnline(false);
        component = renderer.create(<OfflineBanner />);
      });

      // Now go back online and allow exit animation to complete inside act
      await act(async () => {
        useOfflineStore.getState().setOnline(true);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const calls = timingSpy.mock.calls.map((c) => c[1]);
      const exitTranslateYCall = calls.find((c: any) => c && c.toValue === -24 && c.duration === 150);
      expect(exitTranslateYCall).toBeDefined();
      expect(exitTranslateYCall.useNativeDriver).toBe(true);

      const exitOpacityCall = calls.find((c: any) => c && c.toValue === 0 && c.duration === 150);
      expect(exitOpacityCall).toBeDefined();
      expect(exitOpacityCall.useNativeDriver).toBe(true);

      timingSpy.mockRestore();
    });
  });
});
