// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo
//
// NOTE: segments are sanitized below. drizzle's readMigrationFiles() splits
// each file on `--> statement-breakpoint` and dialect.migrate() executes every
// segment via session.run() with no empty check. sqlite3_prepare_v2("") returns
// SQLITE_OK with a NULL statement, and expo-sqlite then calls
// sqlite3_clear_bindings(NULL) -> SIGSEGV (fault addr 0x0) that kills the app
// during initializeDatabase() before any [Database] log prints. drizzle-kit
// writes a trailing breakpoint after the final statement, so the raw split
// always yields an empty last segment.

import journal from './meta/_journal.json';
import m0000 from './0000_gorgeous_saracen.sql';
import m0001 from './0001_violet_sentinel.sql';
import m0002 from './0002_offline_chat_sync_metadata.sql';
import m0003 from './0003_foreground_task_execution.sql';
import m0004 from './0004_checkin_offline_queue.sql';
import m0005 from './0005_message_vectors.sql';
import m0006 from './0006_active_skill.sql';
import m0007 from './0007_agents_and_thread_agent.sql';
import m0008 from './0008_task_connection_mode.sql';

const BREAKPOINT = '--> statement-breakpoint';

/** Drop segments that contain no executable SQL (empty or comments only). */
function sanitizeMigrationSql(sql) {
  return String(sql)
    .split(BREAKPOINT)
    .filter((segment) =>
      segment
        .split(/\r?\n/)
        .some((line) => {
          const trimmed = line.trim();
          return trimmed.length > 0 && !trimmed.startsWith('--');
        })
    )
    .join(BREAKPOINT);
}

export default {
  journal,
  migrations: {
    m0000: sanitizeMigrationSql(m0000),
    m0001: sanitizeMigrationSql(m0001),
    m0002: sanitizeMigrationSql(m0002),
    m0003: sanitizeMigrationSql(m0003),
    m0004: sanitizeMigrationSql(m0004),
    m0005: sanitizeMigrationSql(m0005),
    m0006: sanitizeMigrationSql(m0006),
    m0007: sanitizeMigrationSql(m0007),
    m0008: sanitizeMigrationSql(m0008),
  },
};
