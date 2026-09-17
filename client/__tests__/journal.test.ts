jest.mock('../db/checkinRepository', () => ({
  loadCheckins: jest.fn(async () => []),
  saveCheckinLocal: jest.fn(async (input: { date: string }) => ({ id: `checkin-${input.date}` })),
  markCheckinSynced: jest.fn(async () => undefined),
}));

import {
  fetchRemoteCheckins,
  refreshJournalFromBackend,
  fetchCheckinSummary,
} from '../utils/journal';
import { loadCheckins, saveCheckinLocal, markCheckinSynced } from '../db/checkinRepository';

const repoMocks = {
  loadCheckins: loadCheckins as jest.Mock,
  saveCheckinLocal: saveCheckinLocal as jest.Mock,
  markCheckinSynced: markCheckinSynced as jest.Mock,
};

describe('journal data layer (wayfinder #120)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    repoMocks.loadCheckins.mockResolvedValue([{ id: 'checkin-2026-09-17', date: '2026-09-17' }]);
  });

  describe('fetchRemoteCheckins', () => {
    it('returns null when the backend is unconfigured', async () => {
      await expect(fetchRemoteCheckins('', '', 'conv-1')).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('GETs recent entries for the conversation', async () => {
      const entries = [{ id: 'a', date: '2026-09-17', mood: 4, energy: 3 }];
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => entries });

      await expect(fetchRemoteCheckins('https://vela.test', 'key', 'conv-1')).resolves.toEqual(entries);

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('https://vela.test/api/checkins?');
      expect(url).toContain('conversation_id=conv-1');
      expect(url).toContain('days=14');
      expect(opts.headers.Authorization).toBe('Bearer key');
    });

    it('returns null on backend errors or malformed payloads', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      await expect(fetchRemoteCheckins('https://vela.test', 'key')).resolves.toBeNull();

      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
      await expect(fetchRemoteCheckins('https://vela.test', 'key')).resolves.toBeNull();

      (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
      await expect(fetchRemoteCheckins('https://vela.test', 'key')).resolves.toBeNull();
    });
  });

  describe('refreshJournalFromBackend', () => {
    it('merges remote rows into the local cache as synced and returns local rows', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 'a', date: '2026-09-17', mood: 4, energy: 3, win: 'W', carrying: null, note: null },
        ],
      });

      const rows = await refreshJournalFromBackend('https://vela.test', 'key', 'conv-1');

      expect(repoMocks.saveCheckinLocal).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-09-17', mood: 4 })
      );
      expect(repoMocks.markCheckinSynced).toHaveBeenCalledWith('checkin-2026-09-17');
      expect(rows).toEqual([{ id: 'checkin-2026-09-17', date: '2026-09-17' }]);
    });

    it('falls back to the local cache when offline', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

      const rows = await refreshJournalFromBackend('https://vela.test', 'key');

      expect(repoMocks.saveCheckinLocal).not.toHaveBeenCalled();
      expect(rows).toEqual([{ id: 'checkin-2026-09-17', date: '2026-09-17' }]);
    });
  });

  describe('fetchCheckinSummary', () => {
    it('returns the pattern payload for the cards', async () => {
      const payload = { count: 3, summary: 'Steady week.', avg_mood: 4, avg_energy: 3 };
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => payload });

      await expect(fetchCheckinSummary('https://vela.test', 'key', 'conv-1')).resolves.toEqual(payload);

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/api/checkins/summary?');
    });

    it('returns null when unavailable or malformed', async () => {
      await expect(fetchCheckinSummary('', '')).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();

      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ count: 'x' }) });
      await expect(fetchCheckinSummary('https://vela.test', 'key')).resolves.toBeNull();
    });
  });
});
