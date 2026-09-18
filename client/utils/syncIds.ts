/**
 * Cursor-safe sync IDs (wayfinder T5, issue #253).
 *
 * DECISION — scheme (a): every client-generated sync id is a pure ULID.
 * Rejected scheme (b) (server orders/filters by created_at then id) because
 * it would require a composite cursor format and still leave client-side
 * ties unresolved.
 *
 * Why pure ULIDs with no `msg_` / `devicestep_` prefix: `sync_pull` paginates
 * with `SyncMessage.id > cursor ORDER BY id ASC`. Any constant prefix makes
 * ids sort by TYPE first (`devicestep_*` < `msg_assistant_*` < `msg_user_*`)
 * regardless of creation time, so a page ending on a `msg_user_*` cursor
 * would skip every `msg_assistant_*` row (finding-009). Pure ULIDs sort by
 * time across all types, so one cursor traverses the whole table safely.
 *
 * Device steps: ids are ULIDs AND rows carry `provider = "android_client"`,
 * which the existing `sync_pull` filter (`provider != "android_client"`)
 * already excludes from the pull cursor. The cursor therefore only ever
 * traverses server-issued cloud ULIDs; device-step ids cannot poison it even
 * if they land in `sync_messages`.
 *
 * Port of `backend/utils/ulid.py` (Crockford Base32, 48-bit ms timestamp +
 * 80-bit randomness). Uses `Math.random` like the backend uses the `random`
 * module — no expo-crypto dependency, and safe under Jest (no native bridge).
 * Same-ms ties fall back to random order, matching backend semantics; ties
 * between client rows are harmless because client messages are excluded from
 * the pull cursor and local display orders by `created_at`.
 */

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ULID_LENGTH = 26;

export function generateUlid(nowMs: number = Date.now()): string {
  let timestampMs = Math.floor(nowMs);

  // Encode 48-bit timestamp, big-endian (10 chars).
  const tsChars: string[] = [];
  let val = timestampMs;
  for (let i = 0; i < 10; i++) {
    tsChars.push(CROCKFORD_BASE32[val % 32]);
    val = Math.floor(val / 32);
  }
  const tsStr = tsChars.reverse().join('');

  // Encode 80-bit randomness (16 chars).
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += CROCKFORD_BASE32[Math.floor(Math.random() * 32)];
  }

  return tsStr + randStr;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(id: string): boolean {
  return ULID_RE.test(id);
}
