import { drizzle } from 'drizzle-orm/sql-js';
import * as schema from './schema';
import migrations from './migrations/migrations';
import type { SQLJsDatabase } from 'drizzle-orm/sql-js';

export const isE2E = process.env.EXPO_PUBLIC_E2E === '1';

let SQLModule: any = null;
let rawDbInstance: any = null;
let drizzleDbInstance: SQLJsDatabase<typeof schema> | null = null;
let isMigrated = false;

export function getE2EDb(): SQLJsDatabase<typeof schema> | null {
  return drizzleDbInstance;
}

export function getE2ERawDb(): any {
  return rawDbInstance;
}

export async function getSqlModule(): Promise<any> {
  if (SQLModule) return SQLModule;
  if (typeof globalThis !== 'undefined' && typeof require !== 'undefined') {
    try {
      const util = require('util');
      if (util.TextDecoder && (!globalThis.TextDecoder || (globalThis.TextDecoder as any).name !== 'TextDecoder')) {
        globalThis.TextDecoder = util.TextDecoder;
        globalThis.TextEncoder = util.TextEncoder;
      }
    } catch {
      // ignore in environments without util
    }
  }
  const initSqlJs = require('sql.js');
  SQLModule = await initSqlJs();
  return SQLModule;
}

export function applyMigrationsToSqlJs(db: any): void {
  // Ensure __drizzle_migrations table exists for migration tracking
  db.run('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric);');

  const { journal, migrations: migrationBundle } = migrations;
  for (const entry of journal.entries) {
    const key = `m${entry.idx.toString().padStart(4, '0')}`;
    const rawSql = (migrationBundle as Record<string, string>)[key];
    if (!rawSql) continue;

    const statements = rawSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (let stmt of statements) {
      // sql.js does not include SQLite FTS5 extension by default; skip virtual table statements
      if (stmt.includes('messages_fts')) continue;
      // In 0001_violet_sentinel.sql, tasks.updated_at was created NOT NULL without default,
      // but app code and Drizzle schema omit updated_at on insert. Provide default 0.
      if (stmt.includes('`tasks`') && stmt.includes('`updated_at` integer NOT NULL')) {
        stmt = stmt.replace('`updated_at` integer NOT NULL', '`updated_at` integer DEFAULT 0');
      }
      db.run(stmt);
    }

    db.run('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?);', ['hash', entry.when]);
  }
}

export async function initE2EDatabase(): Promise<SQLJsDatabase<typeof schema>> {
  if (drizzleDbInstance && isMigrated) {
    return drizzleDbInstance;
  }

  const SQL = await getSqlModule();
  if (!rawDbInstance) {
    try {
      rawDbInstance = new SQL.Database();
    } catch (err: any) {
      console.error('SQL.Database creation error details:', err?.message, err?.code, err?.errcode, err);
      throw err;
    }
    rawDbInstance.execSync = function (sql: string) {
      return rawDbInstance.exec(sql);
    };
  }

  if (!isMigrated) {
    applyMigrationsToSqlJs(rawDbInstance);
    isMigrated = true;
  }

  drizzleDbInstance = drizzle(rawDbInstance, { schema });
  return drizzleDbInstance;
}

export async function resetE2EDatabase(): Promise<void> {
  const SQL = await getSqlModule();
  if (rawDbInstance && typeof rawDbInstance.close === 'function') {
    try {
      rawDbInstance.close();
    } catch {
      // ignore close errors on teardown
    }
  }

  rawDbInstance = new SQL.Database();
  rawDbInstance.execSync = function (sql: string) {
    return rawDbInstance.exec(sql);
  };
  applyMigrationsToSqlJs(rawDbInstance);
  isMigrated = true;
  drizzleDbInstance = drizzle(rawDbInstance, { schema });
}
