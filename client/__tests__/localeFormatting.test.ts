/**
 * Wayfinder #551 — deterministic locale / date formatting contract.
 *
 * Production formatters previously took only `undefined` locale, so their
 * output leaked the host locale and hour cycle. The additive `options`
 * parameter ({ locale, timeZone, hour12 }) pins formatting deterministically;
 * these tests exercise it with explicit locales and time zones instead of
 * relying on the host default.
 */
import {
  parseSafeDate,
  formatTimestamp,
  formatDateDividerLabel,
} from '../utils/date';

describe('localeFormatting: timezone parsing (explicit offsets)', () => {
  it('normalizes +05:30 to the same UTC instant', () => {
    const parsed = parseSafeDate('2026-09-21T10:42:00+05:30');
    expect(parsed?.toISOString()).toBe('2026-09-21T05:12:00.000Z');
  });

  it('normalizes -08:00 to the same UTC instant', () => {
    const parsed = parseSafeDate('2026-09-21T10:42:00-08:00');
    expect(parsed?.toISOString()).toBe('2026-09-21T18:42:00.000Z');
  });

  it('normalizes date-line offset +14:00 across the calendar day', () => {
    const parsed = parseSafeDate('2026-09-21T02:00:00+14:00');
    expect(parsed?.toISOString()).toBe('2026-09-20T12:00:00.000Z');
  });

  it('rejects impossible offsets / dates deterministically', () => {
    expect(parseSafeDate('2026-02-30T10:42:00+05:30')).toBeNull();
    expect(parseSafeDate('2026-09-21T25:00:00Z')).toBeNull();
  });
});

describe('localeFormatting: formatTimestamp with pinned locale + zone', () => {
  it('en-US 12-hour UTC: "10:42 AM"', () => {
    expect(
      formatTimestamp('2026-09-21T10:42:00.000Z', { locale: 'en-US', timeZone: 'UTC', hour12: true })
    ).toBe('10:42 AM');
  });

  it('en-GB 24-hour UTC: "10:42" (no AM/PM marker)', () => {
    expect(
      formatTimestamp('2026-09-21T10:42:00.000Z', { locale: 'en-GB', timeZone: 'UTC', hour12: false })
    ).toBe('10:42');
  });

  it('12-hour midnight/noon edges: 12:05 AM / 12:05 PM', () => {
    expect(
      formatTimestamp('2026-09-21T00:05:00.000Z', { locale: 'en-US', timeZone: 'UTC', hour12: true })
    ).toBe('12:05 AM');
    expect(
      formatTimestamp('2026-09-21T12:05:00.000Z', { locale: 'en-US', timeZone: 'UTC', hour12: true })
    ).toBe('12:05 PM');
  });

  it('24-hour midnight stays "00:05" (not the 24:00 quirk)', () => {
    expect(
      formatTimestamp('2026-09-21T00:05:00.000Z', { locale: 'en-GB', timeZone: 'UTC', hour12: false })
    ).toBe('00:05');
  });

  it('same instant, three zones: UTC 10:42 / New_York 06:42 / Tokyo 19:42', () => {
    const raw = '2026-09-21T10:42:00.000Z';
    expect(formatTimestamp(raw, { locale: 'en-GB', timeZone: 'UTC', hour12: false })).toBe('10:42');
    // EDT (UTC-4) in September.
    expect(
      formatTimestamp(raw, { locale: 'en-GB', timeZone: 'America/New_York', hour12: false })
    ).toBe('06:42');
    expect(
      formatTimestamp(raw, { locale: 'en-GB', timeZone: 'Asia/Tokyo', hour12: false })
    ).toBe('19:42');
  });

  it('DST: same UTC noon is 07:00 in winter (EST) and 08:00 in summer (EDT)', () => {
    expect(
      formatTimestamp('2026-01-15T12:00:00.000Z', { locale: 'en-GB', timeZone: 'America/New_York', hour12: false })
    ).toBe('07:00');
    expect(
      formatTimestamp('2026-07-15T12:00:00.000Z', { locale: 'en-GB', timeZone: 'America/New_York', hour12: false })
    ).toBe('08:00');
  });

  it('hour12=false never carries AM/PM even for en-US locale', () => {
    const out = formatTimestamp('2026-09-21T10:42:00.000Z', {
      locale: 'en-US',
      timeZone: 'UTC',
      hour12: false,
    });
    expect(out).toBe('10:42');
    expect(out).not.toMatch(/AM|PM/);
  });

  it('pinned output matches a directly constructed Intl formatter', () => {
    const date = new Date('2026-09-21T10:42:00.000Z');
    const expected = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Berlin',
    }).format(date);
    expect(formatTimestamp('2026-09-21T10:42:00.000Z', { locale: 'de-DE', timeZone: 'Europe/Berlin', hour12: false })).toBe(expected);
  });

  it('defaults (no options) still produce a HH:MM shape — host locale, tolerant only', () => {
    expect(formatTimestamp('2026-09-21T10:42:00.000Z')).toMatch(/^\d{1,2}:\d{2}/);
    expect(formatTimestamp('garbage')).toBeNull();
  });
});

describe('localeFormatting: formatDateDividerLabel with pinned locale', () => {
  it('Today/Yesterday literals are locale-independent (English contract)', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const sameDay = new Date(2026, 8, 21, 8, 30, 0);
    const yesterday = new Date(2026, 8, 20, 22, 10, 0);
    expect(formatDateDividerLabel(sameDay, now, { locale: 'de-DE' })).toBe('Today');
    expect(formatDateDividerLabel(yesterday, now, { locale: 'de-DE' })).toBe('Yesterday');
  });

  it('same-year label, en-US: "Wed, Jun 10"', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const earlier = new Date(2026, 5, 10, 12, 0, 0);
    expect(formatDateDividerLabel(earlier, now, { locale: 'en-US' })).toBe('Wed, Jun 10');
  });

  it('same-year label, de-DE differs from en-US and matches Intl (pinned, not host)', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const earlier = new Date(2026, 5, 10, 12, 0, 0);
    const expected = new Intl.DateTimeFormat('de-DE', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(earlier);
    const label = formatDateDividerLabel(earlier, now, { locale: 'de-DE' });
    expect(label).toBe(expected);
    expect(label).not.toBe(formatDateDividerLabel(earlier, now, { locale: 'en-US' }));
    expect(label).not.toContain('2026');
  });

  it('prior-year label, en-US includes the year: "Sep 15, 2025"', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const lastYear = new Date(2025, 8, 15, 12, 0, 0);
    expect(formatDateDividerLabel(lastYear, now, { locale: 'en-US' })).toBe('Sep 15, 2025');
  });

  it('prior-year label, de-DE matches pinned Intl', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0);
    const lastYear = new Date(2025, 8, 15, 12, 0, 0);
    const expected = new Intl.DateTimeFormat('de-DE', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(lastYear);
    expect(formatDateDividerLabel(lastYear, now, { locale: 'de-DE' })).toBe(expected);
  });

  it('zone-aware Today: UTC says Today, America/New_York says Yesterday (same instants)', () => {
    const date = new Date('2026-09-21T02:00:00.000Z');
    const now = new Date('2026-09-21T20:00:00.000Z');
    expect(formatDateDividerLabel(date, now, { locale: 'en-US', timeZone: 'UTC' })).toBe('Today');
    // 02:00Z is Sep 20 22:00 in New York; 20:00Z is Sep 21 16:00 there.
    expect(formatDateDividerLabel(date, now, { locale: 'en-US', timeZone: 'America/New_York' })).toBe('Yesterday');
  });

  it('zone-aware Yesterday ahead of UTC: Tokyo says Yesterday while UTC says Today', () => {
    const date = new Date('2026-09-21T14:00:00.000Z');
    const now = new Date('2026-09-21T16:00:00.000Z');
    expect(formatDateDividerLabel(date, now, { locale: 'en-US', timeZone: 'UTC' })).toBe('Today');
    // 14:00Z is Sep 21 23:00 in Tokyo; 16:00Z is Sep 22 01:00 there.
    expect(formatDateDividerLabel(date, now, { locale: 'en-US', timeZone: 'Asia/Tokyo' })).toBe('Yesterday');
  });

  it('zoned date label uses the pinned zone for month/day rendering', () => {
    // 2026-09-21T02:00Z is still Sep 20 in New York — the en-US label for
    // that instant in the zone must name Sep 20, not Sep 21.
    const now = new Date('2026-09-25T20:00:00.000Z');
    const date = new Date('2026-09-21T02:00:00.000Z');
    const expected = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    }).format(date);
    expect(expected).toContain('Sep 20');
    expect(formatDateDividerLabel(date, now, { locale: 'en-US', timeZone: 'America/New_York' })).toBe(expected);
  });
});
