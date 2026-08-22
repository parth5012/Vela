// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { LayoutAnimation } from 'react-native';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';

describe('CollapsibleBlock scrolling behavior', () => {
  let layoutAnimationSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    layoutAnimationSpy = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    layoutAnimationSpy.mockRestore();
  });

  it('should not call LayoutAnimation when toggling collapsed state', () => {
    let component: any;
    act(() => {
      component = renderer.create(
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

    // Find the Pressable header node by looking for onPress prop
    const pressable = component.root.find((node: any) => node.props.onPress !== undefined);
    
    // Reset layout animation spy count just in case mount triggered anything
    layoutAnimationSpy.mockClear();

    // Toggle collapse programmatically
    act(() => {
      pressable.props.onPress();
    });

    // Advance fake timers to flush animation callbacks inside act
    act(() => {
      jest.advanceTimersByTime(250);
      jest.runAllTimers();
    });

    // Verify LayoutAnimation.configureNext was NOT called
    expect(layoutAnimationSpy).not.toHaveBeenCalled();
  });
});

