import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated, AccessibilityInfo } from 'react-native';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import DrawerContent from '../components/ui/DrawerContent';
import PressableScale from '../components/ui/PressableScale';
import { PRESS_SCALE } from '../utils/motion';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
  }),
  useNavigation: () => ({
    closeDrawer: jest.fn(),
  }),
}));

jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('../utils/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

const mockThemeColors = {
  card: '#1e293b',
  text: '#f8fafc',
  textDark: '#64748b',
  textMuted: '#94a3b8',
  border: '#334155',
  bubbleAssistant: '#0f172a',
  background: '#020617',
};

const mockThemeSizes = {
  text: 14,
  sub: 12,
};

describe('CollapsibleBlock Motion & Haptics Contract', () => {
  it('animates arrow rotation and content reveal on the native driver', () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    let component: any;

    act(() => {
      component = renderer.create(
        <CollapsibleBlock
          type="thought"
          isClosed={true}
          themeColors={mockThemeColors}
          themeSizes={mockThemeSizes}
          accentHex="#6366f1"
        >
          <React.Fragment />
        </CollapsibleBlock>
      );
    });

    const header = component.root.findByType(PressableScale);
    expect(header.props.scaleTo).toBe(PRESS_SCALE.button);

    // Toggle expand
    act(() => {
      header.props.onPress();
    });

    // Check that native driver timing animations were dispatched
    const nativeDriverCalls = timingSpy.mock.calls.filter(
      (call: any[]) => call[1] && call[1].useNativeDriver === true
    );
    expect(nativeDriverCalls.length).toBeGreaterThanOrEqual(1);

    timingSpy.mockRestore();
  });

  it('bypasses arrow rotation under reduced motion', () => {
    const { useReducedMotion } = require('../hooks/useReducedMotion');
    useReducedMotion.mockReturnValueOnce(true);

    let component: any;
    act(() => {
      component = renderer.create(
        <CollapsibleBlock
          type="thought"
          isClosed={true}
          themeColors={mockThemeColors}
          themeSizes={mockThemeSizes}
          accentHex="#6366f1"
        >
          <React.Fragment />
        </CollapsibleBlock>
      );
    });

    // In reduced motion, arrow text renders static chevron without rotate transform style
    const arrowNode = component.root.findByProps({ children: '▼' });
    expect(arrowNode).toBeDefined();
    const flattenedStyle = [arrowNode.props.style].flat();
    const hasRotate = flattenedStyle.some(
      (s: any) => s && s.transform && s.transform.some((t: any) => t.rotate)
    );
    expect(hasRotate).toBe(false);
  });

  it('sets expandedness immediately when toggling under reduced motion', () => {
    const { useReducedMotion } = require('../hooks/useReducedMotion');
    useReducedMotion.mockReturnValueOnce(true);

    let component: any;
    act(() => {
      component = renderer.create(
        <CollapsibleBlock
          type="thought"
          isClosed={true}
          themeColors={mockThemeColors}
          themeSizes={mockThemeSizes}
          accentHex="#6366f1"
        >
          <React.Fragment />
        </CollapsibleBlock>
      );
    });

    const header = component.root.findByType(PressableScale);
    act(() => {
      header.props.onPress();
    });

    const animatedView = component.root.findAllByType(Animated.View)[0];
    expect(animatedView).toBeDefined();
  });
});

describe('DrawerContent Tactile Micro-Interactions', () => {
  it('renders interactive targets wrapped with PressableScale', () => {
    let component: any;
    act(() => {
      component = renderer.create(<DrawerContent />);
    });

    const pressableScales = component.root.findAllByType(PressableScale);
    expect(pressableScales.length).toBeGreaterThanOrEqual(7);

    // Verify button and row scale tokens are utilized
    const scaleValues = pressableScales.map((p: any) => p.props.scaleTo);
    expect(scaleValues).toContain(PRESS_SCALE.button);
    expect(scaleValues).toContain(PRESS_SCALE.row);
  });
});
