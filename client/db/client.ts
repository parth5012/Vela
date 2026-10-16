import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';

const DATABASE_NAME = 'vela.db';

let expoDbInstance: any = null;
let dbInstance: any = null;

try {
  expoDbInstance = openDatabaseSync(DATABASE_NAME);
  dbInstance = drizzle(expoDbInstance, { schema });
} catch (error) {
  console.warn('[Database] Failed to open expo-sqlite database (likely in test or non-native environment).');
}

export const expoDb = expoDbInstance;
export const db = dbInstance;
export default dbInstance;

/**
 * Strips whitespace-only statements and trailing breakpoints.
 * drizzle-orm's expo-sqlite migrator splits blindly on '--> statement-breakpoint',
 * which produces empty/whitespace statements if a migration ends with a breakpoint.
 * In expo-sqlite, preparing an empty string sets sqlite3_stmt* to NULL, causing
 * an immediate SIGSEGV crash in exsqlite3_clear_bindings+20 during executeSync().
 */
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
