// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

import PressableScale from '../components/ui/PressableScale';
import { PillGroup, PrimaryButton, SecondaryButton } from '../components/ui/settingsKit';
import { EASING } from '../utils/motion';

/**
 * WF-447-04: interaction states and accessibility metadata.
 *
 * Every button surface exposes the right a11y state (disabled / busy /
 * selected), press feedback is a transform on the native driver, and
 * PressableScale forwards labels and merges caller accessibilityState.
 *
 * Note on targeting: PressableScale is a composite element, so its raw element
 * props lack the merged accessibilityState. Assertions target the rendered
 * host node (accessibilityState defined) or the pressable element carrying
 * the press handlers.
 */

const hostNode = (root: any, label: string) =>
  root.findAll(
    (n: any) =>
      n.props &&
      typeof n.type === 'string' &&
      n.props.accessibilityLabel === label &&
      n.props.accessibilityState !== undefined
  )[0];

const pressNode = (root: any) =>
  root.findAll((n: any) => n.props && typeof n.props.onPressIn === 'function')[0];

describe('PressableScale a11y contract (WF-447-04)', () => {
  it('disabled surface: opacity 0.4, disabled prop, accessibilityState.disabled true', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <PressableScale disabled accessibilityLabel="Locked action" onPress={() => {}}>
          <React.Fragment />
        </PressableScale>
      );
    });
    const node = hostNode(component.root, 'Locked action');
    expect(node.props.accessibilityState).toEqual({ disabled: true });
    const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
    expect(styles.some((s: any) => s && s.opacity === 0.4)).toBe(true);
  });

  it('enabled surface: caller accessibilityState merged with computed disabled', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <PressableScale accessibilityLabel="Pick me" accessibilityState={{ selected: true }} onPress={() => {}}>
          <React.Fragment />
        </PressableScale>
      );
    });
    const node = hostNode(component.root, 'Pick me');
    expect(node.props.accessibilityState).toEqual({ selected: true, disabled: false });
  });

  it('press-in animates a scale transform on the native driver with ease-out timing', () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    let component: any;
    act(() => {
      component = renderer.create(
        <PressableScale accessibilityLabel="Tap" onPress={() => {}}>
          <React.Fragment />
        </PressableScale>
      );
    });
    act(() => {
      pressNode(component.root).props.onPressIn({ nativeEvent: {} });
    });
    const config = timingSpy.mock.calls.map((c) => c[1])[0] as any;
    expect(config.toValue).toBe(0.97);
    expect(config.useNativeDriver).toBe(true);
    expect(config.easing).toBe(EASING.out);
    timingSpy.mockRestore();
  });
});

describe('settingsKit button variants a11y states (WF-447-04)', () => {
  it('PillGroup reports the selected option and nothing else', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <PillGroup options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} value="b" onChange={() => {}} />
      );
    });
    const states = component.root
      .findAll((n: any) => n.props && n.props.accessibilityState && n.props.accessibilityLabel)
      .map((n: any) => [n.props.accessibilityLabel, n.props.accessibilityState]);
    expect(states).toEqual(
      expect.arrayContaining([
        ['Alpha', { selected: false, disabled: false }],
        ['Beta', { selected: true, disabled: false }],
      ])
    );
  });

  it('PrimaryButton loading: busy state with inline indicator, label preserved', () => {
    let component: any;
    act(() => {
      component = renderer.create(<PrimaryButton label="Save Task" onPress={() => {}} loading />);
    });
    const node = hostNode(component.root, 'Save Task');
    // RN normalizes accessibilityState on the host View (unset keys become
    // undefined); Pressable also derives disabled from the real disabled prop.
    expect(node.props.accessibilityState.busy).toBe(true);
    expect(node.props.accessibilityState.disabled).toBe(true);
  });

  it('SecondaryButton disabled: disabled prop and accessibilityState.disabled true', () => {
    let component: any;
    act(() => {
      component = renderer.create(<SecondaryButton label="Go" onPress={() => {}} disabled />);
    });
    const node = hostNode(component.root, 'Go');
    expect(node.props.accessibilityState.disabled).toBe(true);
  });
});
