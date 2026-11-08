/**
 * Real in-memory SQLite harness for repository tests (map WF-541, ticket #544
 * prototype; generalized in AFK #548).
 *
 * Backs the `../db/client` module (replaced via jest.mock) with drizzle
 * sqlite-proxy over a node:sqlite `:memory:` database, running the real
 * migration bundle. The thing under test — the repository SQL — is not
 * mocked; only the storage transport is swapped for an in-engine equivalent.
 *
 * Mirrors the inline harness in agentRepository.test.ts and the
 * helpers/sqliteMigrations.ts approach.
 */

import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { applyMigrations } from './sqliteMigrations';

export interface MemoryDbModule {
  db: unknown;
  default: unknown;
  expoDb: null;
  initializeDatabase: () => Promise<void>;
  __sqlite: DatabaseSync;
}

/**
 * Returns a `../db/client` module replacement backed by a fresh in-memory
 * SQLite database with all migrations applied.
 */
export function createMemoryDbClientModule(): MemoryDbModule {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);

  const columnNames = (stmt: any): string[] => {
    try {
      return stmt.columns().map((column: any) => column.name);
    } catch (error) {
      return [];
    }
  };

  const asArrays = (rows: any[], names: string[]) =>
    rows.map((row) => (names.length > 0 ? names.map((name) => row[name]) : Object.values(row)));

  const client = async (
    sql: string,
    params: any[],
    method: 'run' | 'all' | 'values' | 'get'
  ): Promise<{ rows: any[] }> => {
    const stmt = sqlite.prepare(sql);
    if (method === 'run') {
      stmt.run(...params);
      return { rows: [] };
    }
    const names = columnNames(stmt);
    const rows = stmt.all(...params);
    if (method === 'get') {
      if (rows.length === 0) {
        // Empty get must yield undefined rows — drizzle's mapGetResult treats
        // [] as a present row, while undefined maps to `void 0` (no match).
        return { rows: undefined as unknown as any[] };
      }
      return { rows: asArrays(rows.slice(0, 1), names) };
    }
    return { rows: asArrays(rows, names) };
  };

  const db = drizzle(client);

  return {
    db,
    default: db,
    expoDb: null,
    initializeDatabase: async () => {},
    __sqlite: sqlite,
  };
}
