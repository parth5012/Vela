// This file is required for Expo/React Native SQLite migrations: https://orm.drizzle.team/quick-sqlite/expo
import journal from './meta/_journal.json';
import m0000 from './0000_gorgeous_saracen.sql';
import m0001 from './0001_violet_sentinel.sql';
import m0002 from './0002_offline_chat_sync_metadata.sql';
import m0003 from './0003_foreground_task_execution.sql';

// drizzle-orm/expo-sqlite/migrator.js resolves each journal entry via
// migrations[`m${idx.toString().padStart(4, '0')}`] (see readMigrationFiles),
// so the map MUST be an object keyed m0000..mNNNN - an array-shaped value makes
// every lookup undefined and migrate() throws "Missing migration: <tag>".
export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
  },
};
