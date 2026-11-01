// @ts-nocheck
// Self-contained mock of the db client so repository tests never touch
// expo-sqlite. Mirrors the pattern used in chatRepository.test.ts.
jest.mock('../db/client', () => {
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();
  const mockUpdate = jest.fn();

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
    initializeDatabase: jest.fn(async () => {}),
    expoDb: {},
    default: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
  };
});

import { db } from '../db/client';
import {
  checkinRowId,
  saveCheckinLocal,
  loadCheckins,
  loadUnsyncedCheckins,
  markCheckinSynced,
  flushUnsyncedCheckins,
  isCheckinDbAvailable,
} from '../db/checkinRepository';
import { reset as resetMetrics, snapshot as metricSnapshot } from '../utils/metrics';
import {
  STORAGE_QUERY_COUNT_METRIC as STORAGE_QUERY_COUNT,
  HISTORY_MAX_QUERIES,
} from '../utils/storageMetrics';

describe('checkinRepository (local-first check-in queue, wayfinder #117)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  /** Mocks the loadCheckins select→from→orderBy→limit chain. */
  function mockLoadCheckins(rows: unknown[]) {
    (db.select as jest.Mock).mockReturnValueOnce({
      from: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          limit: jest.fn(async () => rows),
        })),
      })),
    });
  }

  describe('checkinRowId', () => {
    it('keys rows by date so same-day saves replace each other', () => {
      expect(checkinRowId('2026-09-17')).toBe('checkin-2026-09-17');
    });
  });

  describe('isCheckinDbAvailable', () => {
    it('reports the mocked db as available', () => {
      expect(isCheckinDbAvailable()).toBe(true);
    });
  });

  describe('saveCheckinLocal', () => {
    it('inserts an unsynced row keyed by date with upsert-on-conflict', async () => {
      const onConflictDoUpdate = jest.fn(async () => undefined);
      const valuesFn = jest.fn(() => ({ onConflictDoUpdate }));
      (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesFn });

      const row = await saveCheckinLocal({
        date: '2026-09-17',
        mood: 4,
        energy: 3,
        win: 'Shipped it',
        carrying: 'Deadlines',
      });

      expect(row.id).toBe('checkin-2026-09-17');
      expect(row.synced).toBe(false);
      const insertArg = valuesFn.mock.calls[0][0];
      expect(insertArg.id).toBe('checkin-2026-09-17');
      expect(insertArg.mood).toBe(4);
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
      // Same-day re-save targets the same id: no duplicate rows.
      expect(onConflictDoUpdate.mock.calls[0][0].target).toBeDefined();
    });

    it('rejects out-of-range mood/energy without touching the db', async () => {
      await expect(
        saveCheckinLocal({ date: '2026-09-17', mood: 0, energy: 3 })
      ).rejects.toThrow(RangeError);
      await expect(
        saveCheckinLocal({ date: '2026-09-17', mood: 3, energy: 6 })
      ).rejects.toThrow(RangeError);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('loadUnsyncedCheckins', () => {
    it('reads rows where synced is false', async () => {
      const whereFn = jest.fn(async () => []);
      (db.select as jest.Mock).mockReturnValueOnce({ from: () => ({ where: whereFn }) });

      await loadUnsyncedCheckins();

      expect(db.select).toHaveBeenCalledTimes(1);
      expect(whereFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('markCheckinSynced', () => {
    it('flips the synced flag for the row id', async () => {
      const whereFn = jest.fn(async () => undefined);
      const setFn = jest.fn(() => ({ where: whereFn }));
      (db.update as jest.Mock).mockReturnValueOnce({ set: setFn });

      await markCheckinSynced('checkin-2026-09-17');

      expect(setFn).toHaveBeenCalledWith({ synced: true });
      expect(whereFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushUnsyncedCheckins', () => {
    function mockPending(rows: any[]) {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: () => ({ where: async () => rows }),
      });
      const whereFn = jest.fn(async () => undefined);
      (db.update as jest.Mock).mockImplementation(() => ({
        set: () => ({ where: whereFn }),
      }));
      return whereFn;
    }

    it('POSTs each pending row and marks successes synced', async () => {
      const rows = [
        { id: 'checkin-2026-09-17', date: '2026-09-17', mood: 4, energy: 3, win: 'W', carrying: 'C', note: null },
        { id: 'checkin-2026-09-16', date: '2026-09-16', mood: 2, energy: 2, win: null, carrying: null, note: null },
      ];
      mockPending(rows);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await flushUnsyncedCheckins('https://vela.test', 'key', 'conv-1');

      expect(result).toEqual({ syncedCount: 2, failedCount: 0 });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://vela.test/api/checkins');
      expect(JSON.parse(opts.body)).toMatchObject({
        conversation_id: 'conv-1',
        date: '2026-09-17',
        mood: 4,
      });
      expect(db.update).toHaveBeenCalledTimes(2);
    });

    it('keeps failed rows pending for the next trigger', async () => {
      const rows = [
        { id: 'checkin-2026-09-17', date: '2026-09-17', mood: 4, energy: 3, win: null, carrying: null, note: null },
      ];
      mockPending(rows);
      (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

      const result = await flushUnsyncedCheckins('https://vela.test', 'key', 'conv-1');

      expect(result).toEqual({ syncedCount: 0, failedCount: 1 });
      expect(db.update).not.toHaveBeenCalled();
    });

    it('short-circuits without credentials', async () => {
      const result = await flushUnsyncedCheckins('', '', '');
      expect(result).toEqual({ syncedCount: 0, failedCount: 0 });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('storage query metrics (#505)', () => {
    it('increments storage.query.count on the journal-screen load path', async () => {
      resetMetrics();
      mockLoadCheckins([{ id: 'checkin-2026-09-17', date: '2026-09-17' }]);

      await loadCheckins(30);

      expect(metricSnapshot().counters[STORAGE_QUERY_COUNT]).toBe(1);
    });

    it('history screen stays within its budget: at most one query', async () => {
      resetMetrics();
      mockLoadCheckins([]);

      await loadCheckins(30);

      expect(metricSnapshot().counters[STORAGE_QUERY_COUNT]).toBeLessThanOrEqual(
        HISTORY_MAX_QUERIES
      );
    });
  });
});
