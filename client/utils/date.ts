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
  // If ISO-like string without timezone offset or Z, assume UTC
  let normalized = str;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) {
    normalized += 'Z';
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
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
