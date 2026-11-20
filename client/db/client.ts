import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';
import {
  isE2E,
  initE2EDatabase,
  resetE2EDatabase,
  getE2EDb,
  getE2ERawDb,
} from './e2eAdapter';

export { isE2E, resetE2EDatabase };

const DATABASE_NAME = 'vela.db';

let expoDbInstance: any = null;
let dbInstance: any = null;

export function configurePragmas(sqliteDb: any): void {
  if (sqliteDb && typeof sqliteDb.execSync === 'function') {
    sqliteDb.execSync('PRAGMA journal_mode = WAL;');
    sqliteDb.execSync('PRAGMA busy_timeout = 5000;');
    sqliteDb.execSync('PRAGMA synchronous = NORMAL;');
  }
}

try {
  expoDbInstance = openDatabaseSync(DATABASE_NAME);
  configurePragmas(expoDbInstance);
  dbInstance = drizzle(expoDbInstance, { schema });
} catch (error) {
  if (!isE2E) {
    console.warn('[Database] Failed to open expo-sqlite database (likely in test or non-native environment).');
  }
}

export function sanitizeMigrationSql(sql: string): string {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('--> statement-breakpoint\n');
}

export function getSanitizedMigrations(rawMigrations: typeof migrations): typeof migrations {
  const sanitizedBundle: Record<string, string> = {};
  for (const [key, sql] of Object.entries(rawMigrations.migrations)) {
    sanitizedBundle[key] = typeof sql === 'string' ? sanitizeMigrationSql(sql) : sql;
  }
  return {
    ...rawMigrations,
    migrations: sanitizedBundle as typeof rawMigrations.migrations,
  };
}

let initPromise: Promise<void> | null = null;

export function _resetInitPromiseForTest(): void {
  initPromise = null;
}

export function initializeDatabase(): Promise<void> {
  if (isE2E && !expoDbInstance) {
    if (initPromise) {
      return initPromise;
    }
    initPromise = (async () => {
      await initE2EDatabase();
    })();
    return initPromise;
  }

  if (!dbInstance) {
    console.warn('[Database] Database client not initialized, skipping migrations.');
    return Promise.resolve();
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const sanitized = getSanitizedMigrations(migrations);
      await migrate(dbInstance, sanitized);
      console.log('[Database] Migrations applied successfully.');
    } catch (error) {
      console.error('[Database] Migration error:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

// When in E2E web mode, export proxy objects that dynamically resolve to the E2E sql.js engine
const dbProxy: any = isE2E && !expoDbInstance
  ? new Proxy({}, {
      get(_target, prop) {
        const target = getE2EDb();
        if (!target) return undefined;
        const val = (target as any)[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
      has(_target, prop) {
        const target = getE2EDb();
        return target ? prop in target : false;
      },
    })
  : dbInstance;

const expoDbProxy: any = isE2E && !expoDbInstance
  ? new Proxy({}, {
      get(_target, prop) {
        const target = getE2ERawDb();
        if (!target) return undefined;
        const val = (target as any)[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
      has(_target, prop) {
        const target = getE2ERawDb();
        return target ? prop in target : false;
      },
    })
  : expoDbInstance;

export const expoDb = expoDbProxy;
export const db = dbProxy;
export default dbProxy;
