// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';

const themeColors = {
  card: '#fff',
  border: '#ccc',
  text: '#000',
  textMuted: '#666',
  textDark: '#333',
};
const themeSizes = { text: 14, sub: 12 };

/**
 * CodeRabbit FIX C regression guard.
 *
 * Already-closed content that measures >2000px via onLayout must take the
 * sync collapse path (setValue, no Animated.timing). The effect depends on
 * measuredHeight so it re-evaluates after measurement.
 */
describe('CollapsibleBlock large-block sync path (FIX C)', () => {
  let timingSpy: jest.SpyInstance;
  let setValueSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    timingSpy = jest.spyOn(Animated, 'timing');
    setValueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    timingSpy.mockRestore();
    setValueSpy.mockRestore();
    jest.useRealTimers();
  });

  it('already-closed content measuring >2000px takes the sync path (no timing after layout)', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <CollapsibleBlock
          type="thought"
          isClosed={true}
          input="short"
          themeColors={themeColors}
          themeSizes={themeSizes}
          accentHex="#6366f1"
        >
          <mock-children />
        </CollapsibleBlock>
      );
    });
    // Initial mount with small content takes the animated path.
    expect(timingSpy).toHaveBeenCalled();
    timingSpy.mockClear();
    setValueSpy.mockClear();

    // Simulate onLayout measuring a large block.
    const layoutNode = component.root.findAll(
      (node: any) => node.props && typeof node.props.onLayout === 'function'
    )[0];
    expect(layoutNode).toBeTruthy();
    act(() => {
      layoutNode.props.onLayout({ nativeEvent: { layout: { height: 2500 } } });
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    // Sync large-block path: setValue called, no new Animated.timing.
    expect(setValueSpy).toHaveBeenCalled();
    expect(timingSpy).not.toHaveBeenCalled();
  });
});
