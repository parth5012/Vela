import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';

const DATABASE_NAME = 'vela.db';

let expoDbInstance: any = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

try {
  expoDbInstance = openDatabaseSync(DATABASE_NAME);
  dbInstance = drizzle(expoDbInstance, { schema });
} catch (error) {
  console.warn('[Database] Failed to open expo-sqlite database (likely in test or non-native environment).');
}

export const expoDb = expoDbInstance;
export const db = dbInstance as unknown as ReturnType<typeof drizzle<typeof schema>>;

export async function initializeDatabase() {
  if (!dbInstance) {
    console.warn('[Database] Database client not initialized, skipping migrations.');
    return;
  }
  try {
    await migrate(dbInstance, migrations);
    console.log('[Database] Migrations applied successfully.');
  } catch (error) {
    console.error('[Database] Migration error:', error);
    throw error;
  }
}
