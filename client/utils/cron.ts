/**
 * Zero-dependency 5-field cron parser and scheduler utility for Vela client.
 * Fields: minute (0-59), hour (0-23), day-of-month (1-31), month (1-12), day-of-week (0-7, 0/7=Sun).
 */

const PRESETS = new Set(['15m', '1h', '12h', '24h', 'weekly']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;
const MAX_ITERATIONS = 5 * 366 * MINUTES_PER_DAY;

export function isCronRule(rule: string): boolean {
  if (!rule || typeof rule !== 'string') return false;
  if (PRESETS.has(rule.trim())) return false;
  return isValidCron(rule.trim());
}

interface FieldLimits {
  min: number;
  max: number;
}

const FIELD_LIMITS: FieldLimits[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 },  // day of week (0 and 7 = Sunday)
];

function parseFieldNumbers(field: string, limits: FieldLimits): Set<number> | null {
  const values = new Set<number>();
  const parts = field.split(',');

  for (const part of parts) {
    if (!part) return null;

    if (part === '*') {
      for (let i = limits.min; i <= limits.max; i++) {
        values.add(i);
      }
      continue;
    }

    if (part.startsWith('*/')) {
      const stepStr = part.slice(2);
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0 || step > limits.max) return null;
      for (let i = limits.min; i <= limits.max; i += step) {
        values.add(i);
      }
      continue;
    }

    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start > end || start < limits.min || end > limits.max) {
        return null;
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
      continue;
    }

    const exact = parseInt(part, 10);
    if (isNaN(exact) || exact < limits.min || exact > limits.max) {
      return null;
    }
    values.add(exact);
  }

  // Normalize Sunday in day-of-week (7 -> 0)
  if (limits.max === 7 && values.has(7)) {
    values.add(0);
    values.delete(7);
  }

  return values;
}

export function isValidCron(expression: string): boolean {
  if (!expression || typeof expression !== 'string') return false;
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  for (let i = 0; i < 5; i++) {
    const parsed = parseFieldNumbers(fields[i], FIELD_LIMITS[i]);
    if (!parsed || parsed.size === 0) return false;
  }
  return true;
}

export function calculateNextCronRun(expression: string, fromTimestamp: number): number {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return fromTimestamp + 24 * 60 * 60 * 1000;
  }

  const minuteSet = parseFieldNumbers(fields[0], FIELD_LIMITS[0]);
  const hourSet = parseFieldNumbers(fields[1], FIELD_LIMITS[1]);
  const domSet = parseFieldNumbers(fields[2], FIELD_LIMITS[2]);
  const monthSet = parseFieldNumbers(fields[3], FIELD_LIMITS[3]);
  const dowSet = parseFieldNumbers(fields[4], FIELD_LIMITS[4]);

  if (!minuteSet || !hourSet || !domSet || !monthSet || !dowSet) {
    return fromTimestamp + MS_PER_DAY;
  }

  // Advance by 1 minute from fromTimestamp, zeroing seconds and ms
  const candidate = new Date(fromTimestamp);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const month = candidate.getUTCMonth() + 1;
    if (!monthSet.has(month)) {
      // Advance to next month start
      candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
      candidate.setUTCHours(0, 0, 0, 0);
      iterations += MINUTES_PER_DAY * 28;
      continue;
    }

    const dom = candidate.getUTCDate();
    const dow = candidate.getUTCDay();
    const domMatch = domSet.has(dom);
    const dowMatch = dowSet.has(dow);

    // Standard cron rule: if both DOM and DOW are restricted (not *), matching either suffices
    const domRestricted = fields[2] !== '*';
    const dowRestricted = fields[4] !== '*';
    const dayMatch = domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch;

    if (!dayMatch) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      iterations += MINUTES_PER_DAY;
      continue;
    }

    const hour = candidate.getUTCHours();
    if (!hourSet.has(hour)) {
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const minute = candidate.getUTCMinutes();
    if (!minuteSet.has(minute)) {
      candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
      iterations++;
      continue;
    }

    return candidate.getTime();
  }

  return fromTimestamp + MS_PER_DAY;
}

export function describeCron(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed === '* * * * *') return 'Every minute';
  if (trimmed === '*/15 * * * *') return 'Every 15 minutes';
  if (trimmed === '*/30 * * * *') return 'Every 30 minutes';
  if (trimmed === '0 * * * *') return 'Every hour';
  if (trimmed === '0 0 * * *') return 'Daily at midnight';
  if (trimmed === '0 9 * * *') return 'Daily at 09:00';
  if (trimmed === '0 9 * * 1-5') return 'At 09:00 on weekdays';
  if (trimmed === '0 0 * * 0' || trimmed === '0 0 * * 7') return 'Weekly on Sunday';
  return `Cron (${trimmed})`;
}
