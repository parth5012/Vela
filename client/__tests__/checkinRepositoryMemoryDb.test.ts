/**
 * Prototype for ticket #544 (map WF-541) — check-in repository verified
 * against a real in-memory SQLite database via __tests__/helpers/memoryDb.ts,
 * proving the mock-the-thing-under-test pattern can be replaced with a real
 * storage engine. Generalized across repositories by AFK ticket #548.
 */
jest.mock('../db/client', () => {
  const { createMemoryDbClientModule } = require('./helpers/memoryDb');
  return createMemoryDbClientModule();
});

import { loadCheckins, loadUnsyncedCheckins, markCheckinSynced, saveCheckinLocal } from '../db/checkinRepository';
import type { CheckInEntity } from '../db/schema';

const sqlite: any = jest.requireMock('../db/client').__sqlite;

// instrumentQuery's unknown-promise makes loadCheckins widen to unknown under
// tsc; the repository itself is exercised, only the result typing is pinned.
const loadTypedCheckins = loadCheckins as unknown as (limit?: number) => Promise<CheckInEntity[]>;

describe('checkinRepository on real in-memory SQLite (#544 prototype)', () => {
  beforeEach(() => {
    sqlite.exec('DELETE FROM check_ins');
  });

  it('saves a check-in and reads it back through real SQL', async () => {
    const saved = await saveCheckinLocal({ date: '2026-11-08', mood: 4, energy: 3, win: 'shipped a prototype' });

    expect(saved.synced).toBe(false);
    const rows = await loadTypedCheckins();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-11-08', mood: 4, energy: 3, win: 'shipped a prototype', synced: false });
  });

  it('replaces a same-day check-in via the real upsert', async () => {
    await saveCheckinLocal({ date: '2026-11-08', mood: 2, energy: 2 });
    await saveCheckinLocal({ date: '2026-11-08', mood: 5, energy: 4, note: 'felt better later' });

    const rows = await loadTypedCheckins();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mood: 5, energy: 4, note: 'felt better later' });
  });

  it('marks rows synced so unloadCheckins drops them', async () => {
    await saveCheckinLocal({ date: '2026-11-08', mood: 3, energy: 3 });

    expect(await loadUnsyncedCheckins()).toHaveLength(1);

    await markCheckinSynced('checkin-2026-11-08');

    expect(await loadUnsyncedCheckins()).toHaveLength(0);
    expect((await loadTypedCheckins())[0].synced).toBe(true);
  });
});
