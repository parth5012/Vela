/**
 * Defensive date normalization utilities for chat timestamps.
 *
 * Governed by ADR-0005 and docs/wayfinder/chat-timestamps-spec.md.
 *
 * The backend history sync (`GET /chat/threads/{id}`) emits timezone-naive
 * ISO strings (`exp.created_at.isoformat()`). Standard ECMAScript
 * `Date.parse()` interprets such strings as device-local time, shifting
 * displayed times by the owner's UTC offset. `parseSafeDate` appends `'Z'`
 * to naive ISO strings so they are treated as UTC.
 */

export function parseSafeDate(raw: string | number | undefined | null): Date | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? new Date(raw) : null;
  }
  const str = raw.trim();
  if (!str) return null;
  // Date.parse() silently rolls impossible calendar dates (e.g. Feb 30)
  // into the next month. Validate ISO calendar fields up front so such
  // input uses the invalid-timestamp fallback instead of a fabricated date.
  const dateTime =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(str);
  const dateOnly = dateTime ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  const parts = dateTime ?? dateOnly;
  if (parts) {
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = dateTime ? Number(parts[4]) : 0;
    const minute = dateTime ? Number(parts[5]) : 0;
    const second = dateTime ? Number(parts[6]) : 0;
    if (!hasValidCalendarFields(year, month, day, hour, minute, second)) return null;
  }
  // If ISO-like string without timezone offset or Z, assume UTC
  let normalized = str;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) {
    normalized += 'Z';
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return null;
  // Round-trip: the parsed instant must reproduce the input's calendar
  // fields, guarding against parser rollover quirks that range checks miss.
  if (dateTime && !matchesParsedInstant(dateTime, timestamp)) return null;
  return new Date(timestamp);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function hasValidCalendarFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;
  return true;
}

function matchesParsedInstant(match: RegExpExecArray, timestamp: number): boolean {
  const year = Number(match[1]);
  // Date.UTC maps years 0-99 onto the 1900s, so round-tripping cannot
  // verify them; the field checks above suffice for that range.
  if (year < 100) return true;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  // Fractional seconds beyond millisecond precision are truncated by the
  // parser, so only the leading three digits participate in the check.
  const millis = Number((match[7] ?? '').slice(1, 4).padEnd(3, '0'));
  const tz = match[8];
  if (!tz || tz === 'Z') {
    const parsed = new Date(timestamp);
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() + 1 === month &&
      parsed.getUTCDate() === day &&
      parsed.getUTCHours() === hour &&
      parsed.getUTCMinutes() === minute &&
      parsed.getUTCSeconds() === second &&
      parsed.getUTCMilliseconds() === millis
    );
  }
  const sign = tz[0] === '+' ? 1 : -1;
  const digits = tz.slice(1).replace(':', '');
  const offsetMs = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60000;
  return timestamp === Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMs;
}

export function formatTimestamp(raw: string | number | undefined | null): string | null {
  const date = parseSafeDate(raw);
  if (!date) return null;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateDividerLabel(date: Date, now: Date = new Date()): string {
  const dateKey = toLocalDateKey(date);
  const nowKey = toLocalDateKey(now);
  if (dateKey === nowKey) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dateKey === toLocalDateKey(yesterday)) return 'Yesterday';

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
