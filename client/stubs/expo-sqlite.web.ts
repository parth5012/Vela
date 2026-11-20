/**
 * Web stand-in for `expo-sqlite`.
 *
 * Aliased in `metro.config.js` when `platform === 'web'` to avoid bundling
 * `expo-sqlite/web/worker.ts` and `wa-sqlite.wasm`, which fail Metro web bundling.
 *
 * In E2E web tests, in-memory SQLite is driven by `sql.js` via `client/db/e2eAdapter.ts`.
 */
export function openDatabaseSync(_name: string, _options?: any): never {
  throw new Error('expo-sqlite is native-only: on web E2E, sql.js is used instead.');
}

export function openDatabaseAsync(_name: string, _options?: any): Promise<never> {
  return Promise.reject(new Error('expo-sqlite is native-only: on web E2E, sql.js is used instead.'));
}

export default { openDatabaseSync, openDatabaseAsync };
