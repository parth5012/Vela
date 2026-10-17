import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';

const DATABASE_NAME = 'vela.db';

let expoDbInstance: any = null;
let dbInstance: any = null;
let migrationPromise: Promise<void> | null = null;

try {
  expoDbInstance = openDatabaseSync(DATABASE_NAME);
  dbInstance = drizzle(expoDbInstance, { schema });
} catch (error) {
  console.warn('[Database] Failed to open expo-sqlite database (likely in test or non-native environment).');
}

export const expoDb = expoDbInstance;
export const db = dbInstance;
export default dbInstance;

function sanitizeMigrationSql(sql: string): string {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n--> statement-breakpoint\n');
}

const sanitizedMigrations = {
  journal: migrations.journal,
  migrations: Object.fromEntries(
    Object.entries(migrations.migrations).map(([key, sql]) => [
      key,
      typeof sql === 'string' ? sanitizeMigrationSql(sql) : sql,
    ])
  ),
};

export async function initializeDatabase(): Promise<void> {
  if (!dbInstance) {
    console.warn('[Database] Database client not initialized, skipping migrations.');
    return;
  }
  if (migrationPromise) {
    return migrationPromise;
  }
  migrationPromise = (async () => {
    try {
      await migrate(dbInstance, sanitizedMigrations);
      console.log('[Database] Migrations applied successfully.');
    } catch (error) {
      migrationPromise = null;
      console.error('[Database] Migration error:', error);
      throw error;
    }
  })();
  return migrationPromise;
}
