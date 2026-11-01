/**
 * Per-endpoint network request metrics (WF-499-07 / #506).
 */

import { counter, record, snapshot, type MetricsSnapshot } from './metrics';

export const NETWORK_ENDPOINTS = ['health', 'threads', 'messages', 'tasks', 'sync', 'other'] as const;
export type NetworkEndpoint = (typeof NETWORK_ENDPOINTS)[number];

const KEYWORDS: ReadonlyArray<{ key: NetworkEndpoint; needle: string }> = [
  { key: 'health', needle: 'health' },
  { key: 'threads', needle: 'thread' },
  { key: 'messages', needle: 'message' },
  { key: 'tasks', needle: 'task' },
  { key: 'sync', needle: 'sync' },
];

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function urlPath(url: unknown): string {
  try {
    if (url instanceof Request) return new URL(url.url).pathname;
    if (url instanceof URL) return url.pathname;
    const str = String(url);
    try {
      return new URL(str).pathname;
    } catch {
      return str;
    }
  } catch {
    return String(url);
  }
}

export function classifyEndpoint(url: unknown): NetworkEndpoint {
  const path = urlPath(url).toLowerCase();
  let bestIdx = Infinity;
  let bestKey: NetworkEndpoint = 'other';
  for (const { key, needle } of KEYWORDS) {
    const idx = path.indexOf(needle);
    if (idx !== -1 && idx < bestIdx) {
      bestIdx = idx;
      bestKey = key;
    }
  }
  return bestKey;
}

export function countMetricName(endpoint: NetworkEndpoint | string): string {
  return `net.${endpoint}.count`;
}

export function durationMetricName(endpoint: NetworkEndpoint | string): string {
  return `net.${endpoint}.duration`;
}

export function errorsMetricName(endpoint: NetworkEndpoint | string): string {
  return `net.${endpoint}.errors`;
}

export type FetchLike = (input: any, init?: any) => Promise<any>;

export interface InstrumentFetchOptions {
  classify?: (url: unknown) => string;
}

export function instrumentFetch(fetchImpl: FetchLike, options?: InstrumentFetchOptions): FetchLike {
  const classify = options?.classify ?? classifyEndpoint;
  return async (input: any, init?: any) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const endpoint = classify(url);
    const startedAt = nowMs();
    let response: any = null;
    let thrown: unknown = null;
    try {
      response = await fetchImpl(input, init);
    } catch (err) {
      thrown = err;
    }
    const duration = Math.max(0, nowMs() - startedAt);

    counter(countMetricName(endpoint)).inc();
    record(durationMetricName(endpoint), duration);

    const okFailed = response !== null && response !== undefined && response.ok === false;
    const statusFailed =
      response !== null && response !== undefined && typeof response.status === 'number'
        ? response.status < 200 || response.status >= 300
        : false;
    if (thrown !== null || okFailed || statusFailed) {
      counter(errorsMetricName(endpoint)).inc();
    }

    if (thrown !== null) throw thrown;
    return response;
  };
}

export const NET_DAILY_SUMMARY_METRIC = 'net.daily_summary';

export interface DailySummary {
  endpoints: Record<string, { count: number; errors: number }>;
  totalRequests: number;
  totalErrors: number;
}

export function flushDailySummary(snap?: MetricsSnapshot): DailySummary {
  const snapshot_ = snap ?? snapshot();
  const endpoints: Record<string, { count: number; errors: number }> = {};
  let totalRequests = 0;
  let totalErrors = 0;

  for (const ep of NETWORK_ENDPOINTS) {
    const c = snapshot_.counters[countMetricName(ep)] ?? 0;
    const e = snapshot_.counters[errorsMetricName(ep)] ?? 0;
    endpoints[ep] = { count: c, errors: e };
    totalRequests += c;
    totalErrors += e;
  }

  counter(NET_DAILY_SUMMARY_METRIC).inc(totalRequests);
  return { endpoints, totalRequests, totalErrors };
}
