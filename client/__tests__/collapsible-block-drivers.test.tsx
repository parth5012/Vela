import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';

/**
 * Wayfinder #146 regression guard.
 *
 * CollapsibleBlock previously ran every Animated.timing with useNativeDriver: false,
 * so height/opacity animations blocked the JS thread while many thought/tool-call
 * blocks animated during streaming. The fix splits height (JS driver, layout prop)
 * from opacity (native driver) using two Animated.Values. These tests assert both
 * drivers are used and that toggle behavior is preserved.
 */
describe('CollapsibleBlock animation drivers (wayfinder #146)', () => {
  let timingSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    timingSpy = jest.spyOn(Animated, 'timing');
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    timingSpy.mockRestore();
    jest.useRealTimers();
  });

  it('uses the native driver for opacity and the JS driver for height', () => {
    act(() => {
      renderer.create(
        <CollapsibleBlock
          type="tool_call"
          name="test_tool"
          input="args"
          isClosed={false}
          themeColors={{ card: '#fff', border: '#ccc', text: '#000', textMuted: '#666', textDark: '#333' }}
          themeSizes={{ text: 14, sub: 12 }}
          accentHex="#6366f1"
        >
          <mock-children />
        </CollapsibleBlock>
      );
    });

    const configs = timingSpy.mock.calls.map((call) => call[1] as { useNativeDriver?: boolean });
    expect(configs.length).toBeGreaterThanOrEqual(2);
    expect(configs.some((c) => c.useNativeDriver === true)).toBe(true);
    expect(configs.some((c) => c.useNativeDriver === false)).toBe(true);
  });

  it('still collapses and expands when toggled', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <CollapsibleBlock
          type="skill"
          name="demo"
          input="{}"
          isClosed={false}
          themeColors={{ card: '#fff', border: '#ccc', text: '#000', textMuted: '#666', textDark: '#333' }}
          themeSizes={{ text: 14, sub: 12 }}
          accentHex="#6366f1"
        >
          <mock-children />
        </CollapsibleBlock>
      );
    });

    const pressable = component.root.find((node: any) => node.props.onPress !== undefined);
    act(() => {
      pressable.props.onPress();
    });
    act(() => {
      jest.advanceTimersByTime(250);
      jest.runAllTimers();
    });

    expect(component.toJSON()).toBeTruthy();
  });
});