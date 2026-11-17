import React from 'react';
import { Animated } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import TypingIndicator from '../components/chat/TypingIndicator';
import * as reducedMotionHook from '../hooks/useReducedMotion';

describe('TypingIndicator Micro-interaction', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders 3 dots with accessibility label', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<TypingIndicator accessibilityLabel="Vela is thinking" />);
    });

    const root = tree!.root;
    const container = root.findByProps({ testID: 'typing-indicator' });
    expect(container.props.accessibilityLabel).toBe('Vela is thinking');
    expect(container.props.accessibilityRole).toBe('text');

    const dot0 = root.findByProps({ testID: 'typing-dot-0' });
    const dot1 = root.findByProps({ testID: 'typing-dot-1' });
    const dot2 = root.findByProps({ testID: 'typing-dot-2' });
    expect(dot0).toBeDefined();
    expect(dot1).toBeDefined();
    expect(dot2).toBeDefined();

    act(() => {
      tree!.unmount();
    });
  });

  it('configures staggered looping animations with native driver', () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    const staggerSpy = jest.spyOn(Animated, 'stagger');
    const timingSpy = jest.spyOn(Animated, 'timing');

    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<TypingIndicator />);
    });

    expect(loopSpy).toHaveBeenCalled();
    expect(staggerSpy).toHaveBeenCalled();

    // Verify all timing calls use native driver
    const nativeCalls = timingSpy.mock.calls.filter(
      (c) => c[1]?.useNativeDriver === true
    );
    expect(nativeCalls.length).toBeGreaterThanOrEqual(6); // 2 per dot * 3 dots

    act(() => {
      tree!.unmount();
    });
  });

  it('suppresses looping animation when reduced motion is enabled', () => {
    jest.spyOn(reducedMotionHook, 'useReducedMotion').mockReturnValue(true);
    const loopSpy = jest.spyOn(Animated, 'loop');

    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<TypingIndicator />);
    });

    expect(loopSpy).not.toHaveBeenCalled();

    act(() => {
      tree!.unmount();
    });
  });
});
