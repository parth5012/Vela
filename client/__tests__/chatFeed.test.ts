import { buildChatFeedItems, type ChatFeedItem } from '../utils/chatFeed';
import { toLocalDateKey } from '../utils/date';
import type { Message } from '../store/useChatStore';

function makeMessage(id: string, created_at?: string): Message {
  return { id, role: 'user', content: id, ...(created_at === undefined ? {} : { created_at }) };
}

function localIso(y: number, m: number, d: number, h: number, min: number): string {
  // Build a Date from local components, then emit ISO (UTC) — round-trips
  // through parseSafeDate back to the same local day.
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

describe('buildChatFeedItems', () => {
  it('injects one divider per day cluster in chronological order, then reverses for inverted FlatList', () => {
    const messages = [
      makeMessage('a', localIso(2026, 9, 20, 14, 10)),
      makeMessage('b', localIso(2026, 9, 20, 16, 30)),
      makeMessage('c', localIso(2026, 9, 21, 9, 15)),
      makeMessage('d', localIso(2026, 9, 21, 10, 42)),
    ];

    const items = buildChatFeedItems(messages);

    // Reversed: newest first → d, c, divider-today, b, a, divider-yesterday.
    expect(items.map((i) => i.id)).toEqual([
      'd',
      'c',
      `divider-${toLocalDateKey(new Date(2026, 8, 21, 12, 0, 0))}`,
      'b',
      'a',
      `divider-${toLocalDateKey(new Date(2026, 8, 20, 12, 0, 0))}`,
    ]);

    expect(items[0]).toMatchObject({ type: 'message', id: 'd' });
    expect(items[2]).toMatchObject({ type: 'date_divider' });
    expect(items[5]).toMatchObject({ type: 'date_divider' });

    // Divider sits physically above its day cluster in visual order
    // (i.e. later in the reversed array than its messages).
    const visual = [...items].reverse();
    const dividerTodayIdx = visual.findIndex(
      (i) => i.type === 'date_divider' && i.dateKey === toLocalDateKey(new Date(2026, 8, 21, 12, 0, 0))
    );
    const cIdx = visual.findIndex((i) => i.id === 'c');
    expect(dividerTodayIdx).toBeLessThan(cIdx);
  });

  it('emits a single divider for same-day clusters', () => {
    const messages = [
      makeMessage('a', localIso(2026, 9, 21, 9, 0)),
      makeMessage('b', localIso(2026, 9, 21, 10, 0)),
      makeMessage('c', localIso(2026, 9, 21, 11, 0)),
    ];
    const items = buildChatFeedItems(messages);
    const dividers = items.filter((i) => i.type === 'date_divider');
    expect(dividers).toHaveLength(1);
    expect(items).toHaveLength(4);
  });

  it('coalesces messages with missing/invalid timestamps without spurious dividers', () => {
    const messages = [
      makeMessage('a', localIso(2026, 9, 21, 9, 0)),
      makeMessage('bad-missing'),
      makeMessage('bad-invalid', 'not-a-date'),
      makeMessage('b', localIso(2026, 9, 21, 10, 0)),
    ];
    const items = buildChatFeedItems(messages);
    const dividers = items.filter((i) => i.type === 'date_divider');
    expect(dividers).toHaveLength(1);
    expect(items.map((i) => i.id)).toContain('bad-missing');
    expect(items.map((i) => i.id)).toContain('bad-invalid');
    expect(items.map((i) => i.id).some((id) => id.includes('undefined'))).toBe(false);
  });

  it('handles a leading invalid timestamp without crashing or divider-undefined', () => {
    const messages = [
      makeMessage('bad-first', 'garbage'),
      makeMessage('a', localIso(2026, 9, 21, 9, 0)),
    ];
    const items = buildChatFeedItems(messages);
    expect(items.map((i) => i.id)).toContain('bad-first');
    expect(items.filter((i) => i.type === 'date_divider')).toHaveLength(1);
    for (const item of items) {
      expect(item.id).not.toContain('undefined');
    }
  });

  it('returns empty array for empty input', () => {
    expect(buildChatFeedItems([])).toEqual([]);
  });

  it('uses stable divider ids of the form divider-<dateKey>', () => {
    const messages = [makeMessage('a', localIso(2026, 9, 21, 9, 0))];
    const first = buildChatFeedItems(messages);
    const second = buildChatFeedItems(messages);
    const divider = first.find((i) => i.type === 'date_divider') as Extract<
      ChatFeedItem,
      { type: 'date_divider' }
    >;
    expect(divider.id).toBe(`divider-${divider.dateKey}`);
    expect(second.find((i) => i.type === 'date_divider')!.id).toBe(divider.id);
  });
});
