import { isValidCron, calculateNextCronRun, describeCron, isCronRule } from '../cron';

describe('cron utilities', () => {
  describe('isValidCron', () => {
    it('validates standard 5-field cron expressions', () => {
      expect(isValidCron('* * * * *')).toBe(true);
      expect(isValidCron('*/15 * * * *')).toBe(true);
      expect(isValidCron('0 9 * * 1-5')).toBe(true);
      expect(isValidCron('30 4 1,15 * 5')).toBe(true);
      expect(isValidCron('0 0 1 1 *')).toBe(true);
    });

    it('rejects invalid cron expressions', () => {
      expect(isValidCron('')).toBe(false);
      expect(isValidCron('* * * *')).toBe(false);
      expect(isValidCron('* * * * * *')).toBe(false);
      expect(isValidCron('60 * * * *')).toBe(false);
      expect(isValidCron('* 24 * * *')).toBe(false);
      expect(isValidCron('* * 32 * *')).toBe(false);
      expect(isValidCron('* * * 13 *')).toBe(false);
      expect(isValidCron('* * * * 8')).toBe(false);
      expect(isValidCron('abc * * * *')).toBe(false);
    });
  });

  describe('isCronRule', () => {
    it('distinguishes presets from cron expressions', () => {
      expect(isCronRule('15m')).toBe(false);
      expect(isCronRule('1h')).toBe(false);
      expect(isCronRule('12h')).toBe(false);
      expect(isCronRule('24h')).toBe(false);
      expect(isCronRule('weekly')).toBe(false);
      expect(isCronRule('0 9 * * 1-5')).toBe(true);
      expect(isCronRule('*/30 * * * *')).toBe(true);
    });
  });

  describe('calculateNextCronRun', () => {
    it('calculates next run for an hourly cron expression', () => {
      // 2026-11-27 10:15:00 UTC
      const base = new Date('2026-11-27T10:15:00Z').getTime();
      const next = calculateNextCronRun('0 * * * *', base);
      const nextDate = new Date(next);
      expect(nextDate.getUTCMinutes()).toBe(0);
      expect(nextDate.getUTCHours()).toBe(11);
      expect(nextDate.getUTCDate()).toBe(27);
    });

    it('calculates next run for weekday 09:00 cron', () => {
      // 2026-11-27 is a Friday (day 5) at 10:00:00 UTC
      const fridayAfternoon = new Date('2026-11-27T10:00:00Z').getTime();
      // Next weekday 9:00 will be Monday 2026-11-30 at 09:00:00 UTC
      const next = calculateNextCronRun('0 9 * * 1-5', fridayAfternoon);
      const nextDate = new Date(next);
      expect(nextDate.getUTCHours()).toBe(9);
      expect(nextDate.getUTCMinutes()).toBe(0);
      expect(nextDate.getUTCDay()).toBe(1); // Monday
      expect(nextDate.getUTCDate()).toBe(30);
    });
  });

  describe('describeCron', () => {
    it('generates readable descriptions for common expressions', () => {
      expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
      expect(describeCron('0 * * * *')).toBe('Every hour');
      expect(describeCron('0 9 * * 1-5')).toBe('At 09:00 on weekdays');
      expect(describeCron('0 0 * * *')).toBe('Daily at midnight');
    });
  });
});
