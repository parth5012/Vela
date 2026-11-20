/**
 * Native Stub: E2E SQLite Adapter
 *
 * Returned by Metro on iOS and Android to ensure zero test/wasm shims
 * or sql.js dependencies leak into native production builds.
 */

export const isE2E = false;

export async function initE2EDatabase(): Promise<any> {
  return null;
}

export async function resetE2EDatabase(): Promise<void> {}

export function getE2EDb(): any {
  return null;
}

export function getE2ERawDb(): any {
  return null;
}

export async function getSqlModule(): Promise<any> {
  return null;
}
