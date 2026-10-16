import {
  parseSafeDate,
  formatTimestamp,
  toLocalDateKey,
  formatDateDividerLabel,
} from '../utils/date';

describe('parseSafeDate', () => {
  it('parses timezone-naive ISO strings as UTC', () => {
    const parsed = parseSafeDate('2026-09-21T10:42:00');
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-09-21T10:42:00.000Z');
  });

  it('parses naive ISO strings with fractional seconds as UTC', () => {
    const parsed = parseSafeDate('2026-09-21T10:42:00.123');
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-09-21T10:42:00.123Z');
  });

  it('parses UTC strings with trailing Z unchanged', () => {
    const parsed = parseSafeDate('2026-09-21T10:42:00.000Z');
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-09-21T10:42:00.000Z');
  });

  it('parses ISO strings with explicit offset', () => {
    const parsed = parseSafeDate('2026-09-21T10:42:00+02:00');
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-09-21T08:42:00.000Z');
  });

  it('parses epoch milliseconds', () => {
    const ms = Date.parse('2026-09-21T10:42:00.000Z');
    const parsed = parseSafeDate(ms);
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(ms);
  });

  it('returns null for invalid strings', () => {
    expect(parseSafeDate('not-a-date')).toBeNull();
  });

  it('returns null for empty / whitespace strings', () => {
    expect(parseSafeDate('')).toBeNull();
    expect(parseSafeDate('   ')).toBeNull();
  });

  it('returns null for undefined and null', () => {
    expect(parseSafeDate(undefined)).toBeNull();
    expect(parseSafeDate(null)).toBeNull();
  });

  it('returns null for NaN, zero, and negative epochs', () => {
    expect(parseSafeDate(NaN)).toBeNull();
    expect(parseSafeDate(0)).toBeNull();
    expect(parseSafeDate(-1000)).toBeNull();
  });

  it('returns null for non-finite epochs', () => {
    expect(parseSafeDate(Infinity)).toBeNull();
    expect(parseSafeDate(-Infinity)).toBeNull();
  });
});

describe('parseSafeDate impossible calendar dates', () => {
  it('rejects February 30 in UTC, naive, and offset shapes', () => {
    expect(parseSafeDate('2026-02-30T10:42:00.000Z')).toBeNull();
    expect(parseSafeDate('2026-02-30T10:42:00')).toBeNull();
    expect(parseSafeDate('2026-02-30T10:42:00+02:00')).toBeNull();
  });

  it('rejects Feb 29 on non-leap years but accepts it on leap years', () => {
    expect(parseSafeDate('2023-02-29T00:00:00Z')).toBeNull();
    const leap = parseSafeDate('2024-02-29T00:00:00Z');
    expect(leap).not.toBeNull();
    expect(leap!.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('rejects out-of-range month, day, and time fields', () => {
    expect(parseSafeDate('2026-13-01T00:00:00Z')).toBeNull();
    expect(parseSafeDate('2026-00-10T00:00:00Z')).toBeNull();
    expect(parseSafeDate('2026-01-32T00:00:00Z')).toBeNull();
    expect(parseSafeDate('2026-01-01T25:00:00Z')).toBeNull();
    expect(parseSafeDate('2026-01-01T10:61:00Z')).toBeNull();
    expect(parseSafeDate('2026-02-30')).toBeNull();
  });

  it('still accepts valid dates in every supported shape', () => {
    expect(parseSafeDate('2026-09-21T10:42:00.1234567Z')).not.toBeNull();
    expect(parseSafeDate('2024-02-29T23:59:59+05:30')).not.toBeNull();
    expect(parseSafeDate('2026-09-21')).not.toBeNull();
  });

  it('formatTimestamp returns null for impossible dates', () => {
    expect(formatTimestamp('2026-02-30T10:42:00Z')).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('formats a valid ISO string into local HH:MM', () => {
    const formatted = formatTimestamp('2026-09-21T10:42:00.000Z');
    expect(formatted).not.toBeNull();
    expect(formatted!).toMatch(/^\d{1,2}:\d{2}/);
  });

  it('formats epoch milliseconds', () => {
    const ms = Date.parse('2026-09-21T10:42:00.000Z');
    expect(formatTimestamp(ms)).toBe(formatTimestamp('2026-09-21T10:42:00.000Z'));
  });

  it('returns null for invalid input', () => {
    expect(formatTimestamp('garbage')).toBeNull();
    expect(formatTimestamp(undefined)).toBeNull();
    expect(formatTimestamp(null)).toBeNull();
    expect(formatTimestamp(NaN)).toBeNull();
  });
});

describe('toLocalDateKey', () => {
  it('returns YYYY-MM-DD in device local timezone', () => {
    // Construct via local components to avoid TZ ambiguity.
    const date = new Date(2026, 8, 21, 10, 42, 0);
    expect(toLocalDateKey(date)).toBe('2026-09-21');
  });

  it('zero-pads single-digit month and day', () => {
    const date = new Date(2026, 0, 5, 8, 0, 0);
    expect(toLocalDateKey(date)).toBe('2026-01-05');
  });
});

describe('formatDateDividerLabel', () => {
  it('returns "Today" for the same local day', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const sameDay = new Date(2026, 8, 21, 8, 30, 0);
    expect(formatDateDividerLabel(sameDay, now)).toBe('Today');
  });

  it('returns "Yesterday" for one day prior', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const yesterday = new Date(2026, 8, 20, 22, 10, 0);
    expect(formatDateDividerLabel(yesterday, now)).toBe('Yesterday');
  });

  it('returns "EEE, MMM d" for earlier days in the current year', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const earlier = new Date(2026, 5, 10, 12, 0, 0);
    const label = formatDateDividerLabel(earlier, now);
    expect(label).toBe(
      earlier.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    );
    expect(label).not.toContain('2026');
  });

  it('returns "MMM d, yyyy" for prior years', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const lastYear = new Date(2025, 8, 15, 12, 0, 0);
    expect(formatDateDividerLabel(lastYear, now)).toBe(
      lastYear.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    );
  });

  it('defaults `now` to the current date', () => {
    expect(formatDateDividerLabel(new Date())).toBe('Today');
  });
});
