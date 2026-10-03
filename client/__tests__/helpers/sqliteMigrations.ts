/**
 * Applies the app's real drizzle migrations to an in-memory SQLite database
 * (node:sqlite) so tests can exercise the shipped schema — FTS5 triggers,
 * foreign keys, `message_vectors` (#299) — without an Android runtime.
 *
 * Statement splitting uses drizzle's `--> statement-breakpoint` marker, never
 * `;`: migration 0002 contains CREATE TRIGGER bodies whose inner `;` would
 * otherwise be split apart.
 */

import migrations from '../../db/migrations/migrations';

export function migrationTags(): string[] {
  return (migrations.journal as { entries: { idx: number; tag: string }[] }).entries.map(
    (e) => e.tag
  );
}

/** Keys of the migration bundle, e.g. `m0005`, in journal order. */
export function migrationKeys(): string[] {
  return migrationTags().map((tag) => `m${tag.split('_')[0]}`);
}

export function applyMigrations(
  db: {
    exec: (sql: string) => void;
  },
  range?: { from?: number; to?: number }
): void {
  const bundle = migrations.migrations as Record<string, string | undefined>;
  const from = range?.from ?? 0;
  const to = range?.to ?? migrationKeys().length - 1;
  for (const key of migrationKeys()) {
    const idx = Number(key.slice(1));
    if (idx < from || idx > to) continue;
    const sql = bundle[key];
    if (typeof sql !== 'string') {
      throw new Error(`migration bundle is missing ${key}`);
    }
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
}
