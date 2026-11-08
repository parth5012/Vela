# Test DB harness (real SQLite, per-test isolation)

Prototype from wayfinder map WF-541 ticket #544. Both stacks can now run
repository, migration, and schema-level behavior against a **real SQLite
engine** — no mocked DB, no shared `test_vela_backend.db`. AFK tickets #548
(backend repositories) and #551 client-side coverage build directly on this.

## Backend: `isolated_db` fixture

`backend/tests/conftest.py` provides the `isolated_db` fixture:

- Creates a fresh SQLite file under pytest's `tmp_path` — one private
  database per test.
- Builds an engine mirroring `db/session.py` exactly: `NullPool`,
  `PRAGMA foreign_keys=ON`, `create_all` over the same `SQLITE_SAFE_TABLES`.
- Rebinds `db.session.engine` and `db.session.SessionLocal` (monkeypatched),
  so every `get_db_session()` call-site in code under test talks to the
  private database.
- The session context mirrors `get_db_session`'s transaction rule: commit on
  clean exit, rollback + re-raise on exception.
- No teardown needed: the engine is discarded and the file vanishes with
  `tmp_path`.

```python
def test_checkin_persists(isolated_db):
    with isolated_db.session() as s:
        s.add(CheckIn(...))
    # a later test sees an empty database — leaks prove real bugs
```

Reference tests: `backend/tests/test_isolated_db_prototype.py`
(no leak across tests, fresh DB per test, FK violations enforced).

To the degree possible, seed through real DBClient/session writes, not raw
SQL fixtures, so schema drift is caught by the same tests that exercise it.

## Client: real in-memory SQLite via `memoryDb` helper

`client/__tests__/helpers/memoryDb.ts` replaces `../db/client` with drizzle
`sqlite-proxy` over `node:sqlite` `DatabaseSync(':memory:')`:

```ts
jest.mock('../db/client', () => {
  const { createMemoryDbClientModule } = require('./helpers/memoryDb');
  return createMemoryDbClientModule();
});
```

- All shipped migrations run for real (same bundle + FTS5 triggers the app
  uses, via `helpers/sqliteMigrations.ts`).
- Repository SQL is exercised unmocked — only the storage transport is
  swapped for an engine-equivalent.
- Empty-get quirk preserved: `{ rows: undefined }` maps to drizzle's
  "no row" path; `[]` would be misread as a present row.

Reference tests: `client/__tests__/checkinRepositoryMemoryDb.test.ts`
(save/read, real upsert conflict resolution, synced-flag flip).

Note: editing only `db/migrations/*.sql` still requires `npx jest --clearCache`
(LEARNINGS.md:71) — the transform cache doesn't track the `.sql` source.

## Verification used for the prototype

- `python vela_ci.py ci --stack backend` — green
- `python vela_ci.py ci --stack client` — green
- Known contention flake: `perf.benchmark.test.ts` timing ratchets can fail
  when sharing workers with other suites (BUG-client-001 class; solo run
  passes). AFK #552's flaky policy should isolate perf lanes like
  `benchmark:ci` already does.
