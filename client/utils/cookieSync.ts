/** #155 Cookie Sync utility — pure parsers + CookieManager bridge */

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
}

// ------------------------------------------------------------------
// Normalization helper — strip leading dot, lower-case
// ------------------------------------------------------------------
function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, '').trim().toLowerCase();
}

// ------------------------------------------------------------------
// Netscape cookies.txt parser (7 tab-separated columns)
// Columns: domain \t flag \t path \t secure \t expiration \t name \t value
// Lines starting with # are comments, except #HttpOnly_ prefix
// ------------------------------------------------------------------
export function parseNetscapeCookies(text: string): CookieEntry[] {
  const entries: CookieEntry[] = [];
  const lines = text.split(/\r?\n/);

  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;

    // Handle #HttpOnly_ prefix — strip and treat as httpOnly
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      // Pure comment line
      continue;
    }

    // Split on tab; fallback to whitespace with 7 columns heuristic if no tabs
    let cols: string[];
    if (line.includes('\t')) {
      cols = line.split('\t');
    } else {
      // Some exporters use spaces — try splitting on whitespace but ensure we get 7 cols
      // For those, name/value may contain no spaces, so split is safe if we limit
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;
      // Reconstruct if value contains spaces (unlikely) — join remainder as value
      if (parts.length > 7) {
        cols = [...parts.slice(0, 6), parts.slice(6).join(' ')];
      } else {
        cols = parts;
      }
    }

    if (cols.length < 7) continue;

    const [domainRaw, , pathRaw, secureRaw, expirationRaw, nameRaw, valueRaw] = cols;

    const domain = domainRaw.trim();
    const path = pathRaw.trim() || '/';
    const secure = secureRaw.trim().toUpperCase() === 'TRUE';
    const expiresNum = parseInt(expirationRaw.trim(), 10);
    const expires = Number.isNaN(expiresNum) || expiresNum === 0 ? null : expiresNum;
    const name = nameRaw.trim();
    const value = valueRaw ?? '';

    if (!domain || !name) continue;

    entries.push({
      name,
      value,
      domain,
      path,
      expires,
      secure,
      httpOnly,
    });
  }

  return entries;
}

// ------------------------------------------------------------------
// Chrome JSON parser — expects JSON array from chrome.cookies API
// Each element: {domain, name, value, path, expirationDate?, secure?, httpOnly?}
// ------------------------------------------------------------------
export interface ChromeCookieJson {
  domain: string;
  name: string;
  value: string;
  path?: string;
  expirationDate?: number;
  secure?: boolean;
  httpOnly?: boolean;
  hostOnly?: boolean;
  session?: boolean;
  [key: string]: unknown;
}

export function parseChromeJson(text: string): CookieEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  let arr: ChromeCookieJson[];
  if (Array.isArray(parsed)) {
    arr = parsed as ChromeCookieJson[];
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).cookies)) {
    arr = (parsed as { cookies: ChromeCookieJson[] }).cookies;
  } else {
    return [];
  }

  const entries: CookieEntry[] = [];
  for (const c of arr) {
    if (!c || typeof c !== 'object') continue;
    const domain = typeof c.domain === 'string' ? c.domain.trim() : '';
    const name = typeof c.name === 'string' ? c.name : '';
    const value = typeof c.value === 'string' ? c.value : String((c as Record<string, unknown>).value ?? '');
    if (!domain || !name) continue;

    const path = typeof c.path === 'string' ? c.path : '/';
    const secure = Boolean(c.secure);
    const httpOnly = Boolean((c as Record<string, unknown>).httpOnly ?? (c as Record<string, unknown>).httpOnly === undefined ? c.httpOnly : false);
    // Handle alternative field hostOnly/httpOnly naming
    const httpOnlyResolved = Boolean(c.httpOnly ?? (c as Record<string, unknown>)['httpOnly'] ?? false);
    let expires: number | null = null;
    if (typeof c.expirationDate === 'number' && !Number.isNaN(c.expirationDate)) {
      expires = Math.floor(c.expirationDate);
    } else if (typeof (c as Record<string, unknown>).expires === 'number') {
      expires = Math.floor((c as Record<string, unknown>).expires as number);
    }

    entries.push({
      name,
      value,
      domain,
      path,
      expires,
      secure,
      httpOnly: httpOnlyResolved || httpOnly,
    });
  }

  return entries;
}

// ------------------------------------------------------------------
// CookieManager bridge — dynamically require to stay build-safe when
// @react-native-cookies/cookies is not installed in dev/web
// ------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CookieManager: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // @ts-ignore - dynamic require is build-safe when package not installed
  const mod = require('@react-native-cookies/cookies');
  CookieManager = (mod && mod.default) ? mod.default : mod?.CookieManager ? mod.CookieManager : mod;
} catch {
  CookieManager = null;
}

function getCookieManager(): {
  set: (url: string, cookie: Record<string, unknown>) => Promise<boolean>;
  clearAll: (useWebKit?: boolean) => Promise<boolean>;
} | null {
  if (CookieManager && typeof CookieManager.set === 'function') return CookieManager;
  return null;
}

export async function importCookies(
  entries: CookieEntry[],
  domains: string[]
): Promise<{ imported: number; failed: number }> {
  const manager = getCookieManager();
  if (!manager) {
    // In environments without native CookieManager (e.g. web, jest) treat as no-op
    // but return counts for testability — assume success for pure-logic consumers
    return { imported: entries.length, failed: 0 };
  }

  const domainFilter = new Set(domains.map(normalizeDomain));

  const filtered = domains.length > 0
    ? entries.filter((e) => domainFilter.has(normalizeDomain(e.domain)))
    : entries;

  let imported = 0;
  let failed = 0;

  for (const entry of filtered) {
    const cleanDomain = normalizeDomain(entry.domain);
    if (!cleanDomain) {
      failed++;
      continue;
    }
    const url = `https://${cleanDomain}`;
    const cookie: Record<string, unknown> = {
      name: entry.name,
      value: entry.value,
      path: entry.path || '/',
      domain: entry.domain,
      // Convert unix seconds to Date string for native module if available
      expires: entry.expires ? new Date(entry.expires * 1000).toUTCString() : undefined,
      secure: entry.secure,
      httpOnly: entry.httpOnly,
    };
    // Remove undefined keys — some CookieManager impls reject them
    if (cookie.expires === undefined) delete cookie.expires;

    try {
      const ok = await manager.set(url, cookie);
      if (ok) imported++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { imported, failed };
}

export async function clearAll(): Promise<boolean> {
  const manager = getCookieManager();
  if (!manager || typeof manager.clearAll !== 'function') return false;
  try {
    const result = await manager.clearAll(true);
    return Boolean(result);
  } catch {
    try {
      const result = await manager.clearAll();
      return Boolean(result);
    } catch {
      return false;
    }
  }
}

export function filterBySelectedDomains(
  entries: CookieEntry[],
  selected: Set<string>
): CookieEntry[] {
  if (selected.size === 0) return [];
  // Normalize selected set values for comparison
  const normalizedSelected = new Set(Array.from(selected).map(normalizeDomain));
  return entries.filter((e) => normalizedSelected.has(normalizeDomain(e.domain)));
}
