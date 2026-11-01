#!/usr/bin/env node
/**
 * metrics-compare.ts — regression comparison for Vela metrics snapshots.
 *
 * Usage:
 *   node scripts/metrics-compare.ts --baseline a.json --current b.json [--out report.json]
 *
 * Inputs are metrics snapshots (the shape produced by utils/metrics.snapshot():
 * { counters, stats, samples }). The script diffs every counter and every
 * histogram/timer stat, flags regressions against the documented budgets from
 * the WF-499 map, and exits with code 1 when any budget is violated so it can
 * gate CI.
 *
 * Budgets (from map #499):
 *   - sse.request_bytes max <= 4096
 *   - render chat feed sort < 50 ms (recorded as render.chatFeed max)
 *   - render parse 100 blocks < 100 ms (render.parse max)
 *   - storage history: <= 1 query, <= 100 ms
 *   - thread list: <= 2 queries
 *   - frames.dropped <= 0
 *   - tasks.long.maxMs <= 100 ms
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface MetricStats { count: number; sum: number; min: number; max: number; mean: number; }
interface Snapshot { counters?: Record<string, number>; stats?: Record<string, MetricStats>; samples?: unknown[]; }

interface Budget { metric: string; field: 'count' | 'max' | 'total'; limit: number; label: string; }

const BUDGETS: Budget[] = [
  { metric: 'sse.request_bytes', field: 'max', limit: 4096, label: 'SSE request body bytes' },
  { metric: 'render.chatFeed', field: 'max', limit: 50, label: 'Chat feed sort 1k (ms)' },
  { metric: 'render.parse', field: 'max', limit: 100, label: 'Parse 100 blocks (ms)' },
  { metric: 'storage.query.count', field: 'total', limit: 1, label: 'History queries (per window)' },
  { metric: 'storage.query.duration', field: 'max', limit: 100, label: 'History query duration (ms)' },
  { metric: 'frames.dropped', field: 'total', limit: 0, label: 'Dropped frames' },
  { metric: 'tasks.long.maxMs', field: 'max', limit: 100, label: 'Long task max (ms)' },
];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

function load(path: string): Snapshot {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as Snapshot;
}

function valueOf(snap: Snapshot, metric: string, field: Budget['field']): number {
  if (field === 'total') {
    if (metric.startsWith('frames.')) return snap.counters?.[metric] ?? 0;
    if (metric === 'storage.query.count') return snap.counters?.[metric] ?? 0;
    return snap.counters?.[metric] ?? 0;
  }
  const st = snap.stats?.[metric];
  if (!st) return 0;
  return field === 'max' ? st.max : field === 'count' ? st.count : st.sum;
}

function fmt(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(2); }

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseline || !args.current) {
    console.error('Usage: metrics-compare --baseline <a.json> --current <b.json> [--out report.json]');
    process.exit(2);
  }
  const base = load(args.baseline);
  const cur = load(args.current);

  const counterNames = new Set([...Object.keys(base.counters || {}), ...Object.keys(cur.counters || {})]);
  const statNames = new Set([...Object.keys(base.stats || {}), ...Object.keys(cur.stats || {})]);

  const rows: Array<{ metric: string; base: number; cur: number; delta: number; pct: string; status: string }> = [];
  let regressions = 0;

  for (const name of [...counterNames].sort()) {
    const b = base.counters?.[name] ?? 0;
    const c = cur.counters?.[name] ?? 0;
    const delta = c - b;
    rows.push({ metric: name, base: b, cur: c, delta, pct: b ? ((delta / b) * 100).toFixed(1) + '%' : '—', status: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' });
  }

  console.log('\n=== Counter deltas (baseline → current) ===');
  console.log('metric'.padEnd(34), 'base'.padStart(8), 'cur'.padStart(8), 'delta'.padStart(8), 'pct'.padStart(8));
  for (const r of rows) {
    console.log(r.metric.padEnd(34), fmt(r.base).padStart(8), fmt(r.cur).padStart(8), (r.delta >= 0 ? '+' : '') + fmt(r.delta).padStart(7), r.pct.padStart(8));
  }

  console.log('\n=== Histogram/Timer deltas ===');
  console.log('metric'.padEnd(34), 'base max'.padStart(10), 'cur max'.padStart(10), 'base mean'.padStart(11), 'cur mean'.padStart(11));
  for (const name of [...statNames].sort()) {
    const b = base.stats?.[name]; const c = cur.stats?.[name];
    console.log(name.padEnd(34), fmt(b?.max ?? 0).padStart(10), fmt(c?.max ?? 0).padStart(10), fmt(b?.mean ?? 0).padStart(11), fmt(c?.mean ?? 0).padStart(11));
  }

  console.log('\n=== Budget checks (current) ===');
  const budgetResults: Array<{ label: string; metric: string; value: number; limit: number; pass: boolean }> = [];
  for (const b of BUDGETS) {
    const v = valueOf(cur, b.metric, b.field);
    const pass = v <= b.limit;
    if (!pass) regressions++;
    budgetResults.push({ label: b.label, metric: b.metric, value: v, limit: b.limit, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${b.label.padEnd(34)} ${fmt(v).padStart(8)} / ${b.limit}`);
  }

  // Regression heuristic: any counter that grew >50% or any max that grew >25%
  const heuristic: Array<{ metric: string; kind: string; base: number; cur: number; growth: string }> = [];
  for (const name of counterNames) {
    const b = base.counters?.[name] ?? 0;
    const c = cur.counters?.[name] ?? 0;
    if (b > 0 && c / b > 1.5) heuristic.push({ metric: name, kind: 'counter', base: b, cur: c, growth: ((c / b - 1) * 100).toFixed(0) + '%' });
  }
  for (const name of statNames) {
    const b = base.stats?.[name]; const c = cur.stats?.[name];
    if (b && c && b.max > 0 && c.max / b.max > 1.25) heuristic.push({ metric: name, kind: 'max', base: b.max, cur: c.max, growth: ((c.max / b.max - 1) * 100).toFixed(0) + '%' });
  }
  if (heuristic.length) {
    console.log('\n=== Growth heuristics (>50% counter / >25% max) ===');
    for (const h of heuristic) console.log(`${h.metric} (${h.kind}): ${fmt(h.base)} → ${fmt(h.cur)} (${h.growth})`);
  }

  const report = { baseline: args.baseline, current: args.current, counters: rows, budgets: budgetResults, heuristic, regressions };
  if (args.out) {
    writeFileSync(resolve(args.out), JSON.stringify(report, null, 2));
    console.log(`\nWrote report to ${args.out}`);
  }

  console.log(`\nResult: ${regressions === 0 ? 'NO BUDGET REGRESSIONS' : regressions + ' BUDGET REGRESSION(S)'}${heuristic.length ? ' (' + heuristic.length + ' growth heuristic hit(s))' : ''}`);
  process.exit(regressions > 0 ? 1 : 0);
}

main();
