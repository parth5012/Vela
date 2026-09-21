import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet, Text } from 'react-native';
import BubbleFooter from '../components/chat/BubbleFooter';
import { formatTimestamp } from '../utils/date';
import type { AuroraGradient, ThemeColors } from '../utils/theme';

// Deterministic timestamp for snapshot stability across timezones (PDT vs UTC CI).
// Only the canonical fixture is pinned; all other inputs delegate to the real implementation
// so invalid/missing cases still exercise the null fallback.
jest.mock('../utils/date', () => {
  const actual = jest.requireActual('../utils/date');
  return {
    ...actual,
    formatTimestamp: jest.fn((raw: string | number | undefined | null) =>
      raw === '2026-09-21T10:42:00.000Z' ? '10:42 AM' : actual.formatTimestamp(raw)
    ),
  };
});

const aurora = {
  acc1: '#8b7cf6',
  acc2: '#7dd3fc',
  glow: 'rgba(139, 124, 246, 0.45)',
  onAccent: '#0b0b1a',
} as AuroraGradient;

const colors = {
  textMuted: '#a9a6c8',
} as ThemeColors;

const CREATED_AT = '2026-09-21T10:42:00.000Z';

function renderFooter(props: Partial<React.ComponentProps<typeof BubbleFooter>> = {}) {
  let component: renderer.ReactTestRenderer | undefined;
  act(() => {
    component = renderer.create(
      <BubbleFooter createdAt={CREATED_AT} isUser={false} aurora={aurora} colors={colors} {...props} />
    );
  });
  return component!;
}

function timestampTextOf(component: renderer.ReactTestRenderer) {
  return component.root.findByType(Text);
}

describe('BubbleFooter', () => {
  it('renders the formatted timestamp for an assistant bubble with textMuted at full opacity', () => {
    const component = renderFooter({ isUser: false });
    const text = timestampTextOf(component);
    expect(text.props.children).toBe(formatTimestamp(CREATED_AT));
    const style = text.props.style;
    expect(style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: colors.textMuted, opacity: 1 }),
      ])
    );
    expect(component.toJSON()).toMatchSnapshot();
    act(() => component.unmount());
  });

  it('renders a user bubble timestamp with onAccent at 0.65 opacity', () => {
    const component = renderFooter({ isUser: true });
    const text = timestampTextOf(component);
    expect(text.props.children).toBe(formatTimestamp(CREATED_AT));
    expect(text.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: aurora.onAccent, opacity: 0.65 }),
      ])
    );
    act(() => component.unmount());
  });

  it('returns null when createdAt is missing (no footer rendered)', () => {
    const component = renderFooter({ createdAt: undefined });
    expect(component.toJSON()).toBeNull();
    act(() => component.unmount());
  });

  it('returns null for unparseable timestamps (never renders "Invalid Date")', () => {
    const component = renderFooter({ createdAt: 'not-a-date' });
    expect(component.toJSON()).toBeNull();
    const texts = component.root.findAllByType(Text);
    expect(texts).toHaveLength(0);
    act(() => component.unmount());
  });

  it('renders the 6dp pulsing dot while an assistant message is streaming', () => {
    const component = renderFooter({ isUser: false, isStreaming: true });
    const dot = component.root.findByProps({ testID: 'bubble-footer-streaming-dot' });
    expect(dot).toBeDefined();
    expect(dot.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: aurora.acc1 }),
      ])
    );
    // Fixed 6dp geometry per spec.
    const flat = StyleSheet.flatten(dot.props.style);
    expect(flat.width).toBe(6);
    expect(flat.height).toBe(6);
    expect(flat.borderRadius).toBe(3);
    act(() => component.unmount());
  });

  it('renders no dot for user bubbles even while streaming', () => {
    const component = renderFooter({ isUser: true, isStreaming: true });
    expect(component.root.findAllByProps({ testID: 'bubble-footer-streaming-dot' })).toHaveLength(0);
    act(() => component.unmount());
  });

  it('renders no dot once streaming ends', () => {
    const component = renderFooter({ isUser: false, isStreaming: false });
    expect(component.root.findAllByProps({ testID: 'bubble-footer-streaming-dot' })).toHaveLength(0);
    act(() => component.unmount());
  });

  it('stops the pulse loop when unmounted mid-stream (clean unmount)', () => {
    const stop = jest.fn();
    const start = jest.fn();
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop } as any);
    const component = renderFooter({ isUser: false, isStreaming: true });
    expect(start).toHaveBeenCalled();
    act(() => component.unmount());
    expect(stop).toHaveBeenCalled();
    loopSpy.mockRestore();
  });
});
