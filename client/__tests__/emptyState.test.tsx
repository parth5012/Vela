// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

jest.mock('../db/chatRepository', () => ({
  saveThread: jest.fn(async () => {}),
  saveThreads: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {}),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: jest.fn(async () => {}),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: jest.fn(async () => {}),
  queueMessageForSync: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('../utils/localLlm', () => ({
  initializeLocalModel: jest.fn(async () => {}),
  streamLocalLlmResponse: jest.fn(),
  isLocalLlmDown: jest.fn(() => false),
  isStoredModelUsable: jest.fn(async () => true),
  localModelStorageKey: jest.fn(),
  LOCAL_MODELS: {},
}));

jest.mock('../utils/toolProxy', () => ({
  parseAndExecuteTools: jest.fn(),
}));

jest.mock('../utils/providers', () => ({
  streamCloudResponse: jest.fn(),
}));

jest.mock('../utils/cloudTools', () => ({
  buildVercelCloudTools: jest.fn(),
}));

jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

import { EmptyChatState, EMPTY_HEADLINE, EMPTY_SUBTEXT, EMPTY_CTA_LABEL } from '../app/index';
import PressableScale from '../components/ui/PressableScale';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { DURATIONS, EASING } from '../utils/motion';

/**
 * WF-447-06: the empty chat state pins (docs/FEELING-CURVE.md, docs/DESIGN.md).
 *
 * - one real headline (<= 8 words), one line of real subtext (<= 20 words)
 * - exactly one primary CTA
 * - exactly one animated element active in the empty state: the single
 *   ease-out entrance. No loops, no staggers, no competing choreography.
 * - reduced motion keeps the fade and drops the travel.
 *
 * Mocks mirror __tests__/chatMultiTurnAbort.test.ts: importing ../app/index
 * drags the whole screen module, so its heavy import chain is stubbed here.
 */

const colors = { text: '#111111', textMuted: '#666666', card: '#ffffff', border: '#dddddd' };
const sizes = {
  text: 14,
  sub: 12,
  title: 20,
  logo: 32,
  lineHeight: 21,
  subLineHeight: 18,
  letterSpacing: 0.1,
  titleLetterSpacing: -0.2,
};
const aurora = { acc1: '#6D3AE8', acc2: '#9B6CF0', onAccent: '#FFFFFF', glow: '#6D3AE8' };

const renderState = (props = {}) => {
  let component: any;
  act(() => {
    component = renderer.create(
      <EmptyChatState colors={colors} sizes={sizes} aurora={aurora} onPressAsk={() => {}} {...props} />
    );
  });
  return component;
};

const textOf = (node: any) =>
  Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

describe('EmptyChatState (WF-447-06)', () => {
  beforeEach(() => {
    (useReducedMotion as jest.Mock).mockReset();
    (useReducedMotion as jest.Mock).mockReturnValue(false);
  });

  it('renders the real headline within the 8-word cap', () => {
    const component = renderState();
    const headline = component.root.find((n: any) => n.props?.testID === 'empty-headline');
    expect(textOf(headline)).toBe(EMPTY_HEADLINE);
    expect(countWords(EMPTY_HEADLINE)).toBeGreaterThan(0);
    expect(countWords(EMPTY_HEADLINE)).toBeLessThanOrEqual(8);
  });

  it('renders one line of real subtext within the 20-word cap', () => {
    const component = renderState();
    const subtext = component.root.find((n: any) => n.props?.testID === 'empty-subtext');
    expect(textOf(subtext)).toBe(EMPTY_SUBTEXT);
    expect(countWords(EMPTY_SUBTEXT)).toBeGreaterThan(0);
    expect(countWords(EMPTY_SUBTEXT)).toBeLessThanOrEqual(20);
  });

  it('has exactly one primary CTA and no other tappable in the core state', () => {
    const component = renderState();
    // testID forwards down the Pressable -> host chain, so count the
    // PressableScale composite itself, not every node carrying the testID.
    const ctas = component.root.findAll(
      (n: any) => n.type === PressableScale && n.props.testID === 'empty-cta'
    );
    expect(ctas).toHaveLength(1);
    expect(ctas[0].props.accessibilityLabel).toBe(EMPTY_CTA_LABEL);
    expect(typeof ctas[0].props.onPress).toBe('function');
    const tappables = component.root.findAll((n: any) => n.type === PressableScale);
    expect(tappables).toHaveLength(1);
  });

  it('runs exactly one animated element: the entrance, with no competing choreography', () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    const staggerSpy = jest.spyOn(Animated, 'stagger');
    const loopSpy = jest.spyOn(Animated, 'loop');
    const springSpy = jest.spyOn(Animated, 'spring');

    renderState();

    expect(timingSpy).toHaveBeenCalledTimes(1);
    expect(staggerSpy).not.toHaveBeenCalled();
    expect(loopSpy).not.toHaveBeenCalled();
    expect(springSpy).not.toHaveBeenCalled();

    const config = timingSpy.mock.calls.map((c) => c[1])[0];
    expect(config.toValue).toBe(1);
    expect(config.duration).toBe(DURATIONS.reveal);
    expect(config.easing).toBe(EASING.out);
    expect(config.useNativeDriver).toBe(true);

    timingSpy.mockRestore();
    staggerSpy.mockRestore();
    loopSpy.mockRestore();
    springSpy.mockRestore();
  });

  it('welcome variant: starters and agent picker render quiet below the single CTA', () => {
    const component = renderState({
      starters: [{ label: 'Research', text: 'Find papers about retrieval', agent: 'personal assistant' }],
      onSelectStarter: () => {},
      agents: [{ id: 'a1', name: 'Personal Assistant', icon: 'X' }],
      currentAgentId: 'a1',
      onSelectAgent: () => {},
    });

    const labels = new Set(
      component.root
        .findAll((n: any) => typeof n.props?.accessibilityLabel === 'string')
        .map((n: any) => n.props.accessibilityLabel)
    );
    const suggestions = [...labels].filter((l) => l.startsWith('Suggestion:'));
    expect(suggestions).toHaveLength(1);

    // The primary CTA survives the variant, and stays the only one.
    expect(
      component.root.findAll((n: any) => n.type === PressableScale && n.props.testID === 'empty-cta')
    ).toHaveLength(1);
  });

  it('reduced motion keeps the fade and drops the travel', () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    const timingSpy = jest.spyOn(Animated, 'timing');

    const component = renderState();

    // The opacity channel (comprehension) is still animated.
    expect(timingSpy).toHaveBeenCalledTimes(1);

    // The position channel is dropped: static translateY 0.
    const root = component.root.find((n: any) => n.props?.testID === 'empty-state-root');
    const styleArr = Array.isArray(root.props.style) ? root.props.style : [root.props.style];
    const transformStyle = styleArr.find((s: any) => s && s.transform);
    expect(transformStyle.transform[0].translateY).toBe(0);

    timingSpy.mockRestore();
    (useReducedMotion as jest.Mock).mockReturnValue(false);
  });
});
