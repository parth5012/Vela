/**
 * Regression: fresh-install native SIGSEGV (signal 11, fault addr 0x0 in
 * exsqlite3_clear_bindings, libexpo-sqlite.so) that killed the app ~1.5s
 * after boot in Expo Go before any `[Database]` log printed.
 *
 * drizzle's readMigrationFiles() splits each migration on the
 * `--> statement-breakpoint` token, and dialect.migrate() executes every
 * segment via session.run() with no empty check. sqlite3_prepare_v2("")
 * returns SQLITE_OK with a NULL statement, and expo-sqlite's run() then
 * calls sqlite3_clear_bindings(NULL), which dereferences the null pointer.
 * A trailing breakpoint (or comment-only segment) at the end of a migration
 * file therefore crashes the whole app inside initializeDatabase().
 */
import migrations from '../db/migrations/migrations';

const isExecutableSegment = (segment: string): boolean =>
  segment.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('--');
  });

type MigrationConfig = {
  journal: { entries: Array<{ idx: number; tag: string }> };
  migrations: Record<string, string>;
};

const config = migrations as unknown as MigrationConfig;

describe('migration SQL loaded by drizzle migrate()', () => {
  it('has an SQL payload for every journal entry', () => {
    for (const entry of config.journal.entries) {
      const key = `m${entry.idx.toString().padStart(4, '0')}`;
      expect(typeof config.migrations[key]).toBe('string');
    }
  });

  it('yields no empty or comment-only statement segments (expo-sqlite null-stmt crash guard)', () => {
    const offenders: string[] = [];
    for (const entry of config.journal.entries) {
      const key = `m${entry.idx.toString().padStart(4, '0')}`;
      const sql = config.migrations[key] ?? '';
      sql.split('--> statement-breakpoint').forEach((segment, index) => {
        if (!isExecutableSegment(segment)) {
          offenders.push(`${key}[${index}]`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
