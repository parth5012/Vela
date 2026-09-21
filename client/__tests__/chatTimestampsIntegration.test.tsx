import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import BubbleFooter from '../components/chat/BubbleFooter';
import DateDividerPill from '../components/chat/DateDividerPill';
import { buildChatFeedItems, type ChatFeedItem } from '../utils/chatFeed';
import { formatTimestamp, toLocalDateKey } from '../utils/date';
import type { Message } from '../store/useChatStore';
import type { AuroraGradient, ThemeColors } from '../utils/theme';

/**
 * Wayfinder #287 — pipeline-level integration for chat timestamps + day dividers.
 *
 * Scope note: rendering full `client/app/index.tsx` pulls heavy deps
 * (Expo Router, navigation, stores, native modules) into mock hell, so the
 * integration seam is `buildChatFeedItems` -> `renderFeedItem`, where
 * `renderFeedItem` mirrors the `renderItem` branch in `index.tsx`
 * (date_divider -> DateDividerPill, message -> BubbleFooter inside the bubble
 * with the same `isStreaming` guard). This covers the full timestamps/day
 * dividers contract without dragging in the app shell.
 */

// Deterministic timestamp for TZ-stable assertions (same pattern as
// BubbleFooter.test.tsx): only the canonical fixture is pinned, everything
// else delegates to the real implementation.
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
  glass: 'rgba(255, 255, 255, 0.055)',
  glassBorder: 'rgba(255, 255, 255, 0.13)',
} as ThemeColors;

function makeMessage(id: string, role: Message['role'], created_at?: string): Message {
  return { id, role, content: `content-${id}`, ...(created_at === undefined ? {} : { created_at }) };
}

function localIso(y: number, m: number, d: number, h: number, min: number): string {
  // Local components -> ISO round-trips through parseSafeDate to the same local day.
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

/** Mirrors the renderItem branch + streaming guard in client/app/index.tsx. */
function renderFeedItem(item: ChatFeedItem, streaming: { active: boolean; lastId: string | null }) {
  if (item.type === 'date_divider') {
    return <DateDividerPill label={item.label} colors={colors} />;
  }
  const message = item.message;
  const isUser = message.role === 'user';
  return (
    <BubbleFooter
      createdAt={message.created_at}
      isUser={isUser}
      isStreaming={!isUser && streaming.active && streaming.lastId === message.id}
      aurora={aurora}
      colors={colors}
    />
  );
}

/** Mirrors the keyExtractor in client/app/index.tsx. */
function keyExtractor(item: ChatFeedItem): string {
  return item.type === 'date_divider' ? item.id : item.message.id;
}

function renderItems(items: ChatFeedItem[], streaming: { active: boolean; lastId: string | null }) {
  let component: renderer.ReactTestRenderer | undefined;
  act(() => {
    component = renderer.create(
      <View>
        {items.map((item) => (
          <View key={keyExtractor(item)}>{renderFeedItem(item, streaming)}</View>
        ))}
      </View>
    );
  });
  return component!;
}

function streamingDots(component: renderer.ReactTestRenderer) {
  // Animated.View contributes composite + host nodes sharing the testID;
  // count the host View only so each pulsing dot counts exactly once.
  return component.root.findAll(
    (node) => node.type === 'View' && node.props?.testID === 'bubble-footer-streaming-dot'
  );
}

function collectTextStrings(component: renderer.ReactTestRenderer): string[] {  return component.root
    .findAllByType(Text)
    .flatMap((t) => {
      const c = t.props.children;
      return typeof c === 'string' ? [c] : [];
    });
}

describe('chat timestamps + day dividers integration (#287)', () => {
  it('renders date dividers in sequence above each day cluster for a multi-day conversation', () => {
    const messages = [
      makeMessage('a', 'user', localIso(2026, 9, 20, 14, 10)),
      makeMessage('b', 'assistant', localIso(2026, 9, 20, 16, 30)),
      makeMessage('c', 'user', localIso(2026, 9, 21, 9, 15)),
      makeMessage('d', 'assistant', '2026-09-21T10:42:00.000Z'),
    ];
    const items = buildChatFeedItems(messages);

    // Inverted feed: newest first -> d, c, divider-day2, b, a, divider-day1.
    expect(items.map((i) => i.id)).toEqual([
      'd',
      'c',
      `divider-${toLocalDateKey(new Date(2026, 8, 21, 12, 0, 0))}`,
      'b',
      'a',
      `divider-${toLocalDateKey(new Date(2026, 8, 20, 12, 0, 0))}`,
    ]);

    const component = renderItems(items, { active: false, lastId: null });

    // Both divider labels render exactly once, in visual (chronological) order.
    const dividerLabels = items
      .filter((i) => i.type === 'date_divider')
      .map((i) => (i.type === 'date_divider' ? i.label : ''));
    const rendered = collectTextStrings(component);
    expect(dividerLabels).toHaveLength(2);
    for (const label of dividerLabels) {
      expect(rendered.filter((s) => s === label)).toHaveLength(1);
    }
    // Chronological order: day-1 divider above day-1 cluster, day-2 above day-2.
    const visual = [...items].reverse();
    const firstDividerIdx = visual.findIndex((i) => i.type === 'date_divider');
    const aIdx = visual.findIndex((i) => i.id === 'a');
    const lastDividerIdx = visual.length - 1 - [...visual].reverse().findIndex((i) => i.type === 'date_divider');
    const dIdx = visual.findIndex((i) => i.id === 'd');
    expect(firstDividerIdx).toBeLessThan(aIdx);
    expect(lastDividerIdx).toBeLessThan(dIdx);

    // The canonical pinned timestamp renders deterministically (TZ-stable).
    expect(rendered).toContain('10:42 AM');
    expect(rendered.some((s) => s.includes('Invalid Date'))).toBe(false);
    act(() => component.unmount());
  });

  it('shows the pulsing dot while streaming and removes it once streaming ends', () => {
    const messages = [
      makeMessage('a', 'user', localIso(2026, 9, 21, 10, 40)),
      makeMessage('b', 'assistant', '2026-09-21T10:42:00.000Z'),
    ];
    const items = buildChatFeedItems(messages);
    const lastId = messages[messages.length - 1].id;

    const streaming = renderItems(items, { active: true, lastId });
    expect(streamingDots(streaming)).toHaveLength(1);
    act(() => streaming.unmount());

    const settled = renderItems(items, { active: false, lastId });
    expect(streamingDots(settled)).toHaveLength(0);
    // Footers still render their timestamps after the stream settles.
    expect(collectTextStrings(settled)).toContain('10:42 AM');
    act(() => settled.unmount());
  });

  it('never shows the streaming dot for a user trailing message', () => {
    const messages = [
      makeMessage('a', 'assistant', localIso(2026, 9, 21, 10, 40)),
      makeMessage('b', 'user', localIso(2026, 9, 21, 10, 42)),
    ];
    const items = buildChatFeedItems(messages);
    const component = renderItems(items, { active: true, lastId: 'b' });
    expect(streamingDots(component)).toHaveLength(0);
    act(() => component.unmount());
  });

  it('survives missing/unparseable timestamps with no crash and no "Invalid Date" text', () => {
    const messages = [
      makeMessage('bad-first', 'user', 'garbage'),
      makeMessage('good', 'assistant', '2026-09-21T10:42:00.000Z'),
      makeMessage('bad-missing', 'user'),
      makeMessage('bad-invalid', 'assistant', 'not-a-date'),
    ];
    let items: ChatFeedItem[] = [];
    expect(() => {
      items = buildChatFeedItems(messages);
    }).not.toThrow();
    expect(items.map((i) => i.id)).toContain('bad-first');
    expect(items.map((i) => i.id)).toContain('bad-missing');
    expect(items.map((i) => i.id)).toContain('bad-invalid');

    let component: renderer.ReactTestRenderer | undefined;
    expect(() => {
      component = renderItems(items, { active: false, lastId: null });
    }).not.toThrow();
    const rendered = collectTextStrings(component!);
    expect(rendered.some((s) => s.includes('Invalid Date'))).toBe(false);
    // Only the parseable message contributes a footer timestamp.
    const expected = formatTimestamp('2026-09-21T10:42:00.000Z');
    expect(rendered.filter((s) => s === expected)).toHaveLength(1);
    act(() => component!.unmount());
  });

  it('exposes TalkBack labels on timestamps and dividers', () => {
    const messages = [
      makeMessage('a', 'assistant', '2026-09-21T10:42:00.000Z'),
      makeMessage('b', 'user', localIso(2026, 9, 21, 10, 43)),
    ];
    const items = buildChatFeedItems(messages);
    const component = renderItems(items, { active: false, lastId: null });

    const footerText = component.root
      .findAllByType(Text)
      .find((t) => t.props.children === '10:42 AM');
    expect(footerText).toBeDefined();
    expect(footerText!.props.accessibilityLabel).toBe('Sent at 10:42 AM');

    const divider = items.find((i) => i.type === 'date_divider');
    expect(divider?.type).toBe('date_divider');
    if (divider?.type === 'date_divider') {
      const pill = component.root.findByProps({ accessibilityLabel: `Date divider: ${divider.label}` });
      expect(pill.props.accessibilityRole).toBe('header');
    }
    act(() => component.unmount());
  });

  it('keeps inverted-FlatList scroll/key invariants: unique keys, stable divider ids, newest first', () => {
    const messages = [
      makeMessage('a', 'user', localIso(2026, 9, 20, 14, 10)),
      makeMessage('b', 'assistant', localIso(2026, 9, 20, 16, 30)),
      makeMessage('c', 'assistant', localIso(2026, 9, 21, 9, 15)),
    ];
    const first = buildChatFeedItems(messages);
    const second = buildChatFeedItems(messages);

    // Newest message at index 0 (inverted FlatList contract).
    expect(first[0]).toMatchObject({ type: 'message', id: 'c' });

    // keyExtractor mirror yields unique keys (no scroll jumps from key collisions).
    const keys = first.map(keyExtractor);
    expect(new Set(keys).size).toBe(keys.length);

    // Stable divider ids across rebuilds (no remount churn on re-render).
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id));
    for (const item of first) {
      if (item.type === 'date_divider') {
        expect(item.id).toBe(`divider-${item.dateKey}`);
      }
    }
  });
});
