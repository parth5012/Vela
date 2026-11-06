#!/usr/bin/env node
/**
 * Visual diff for the `visual-regression` e2e lane (WF-447-07).
 *
 * Compares screenshots captured by runner.sh (--lane visual-regression) in
 * client/e2e/results/visual/ against committed baselines in
 * client/e2e/baselines/ using pixelmatch. Fails when more than 0.5% of
 * pixels differ on any state.
 *
 * Usage:
 *   node e2e/visual-diff.mjs                    # diff current shots
 *   node e2e/visual-diff.mjs --update-baselines # PROMOTE current shots to baselines
 *   node e2e/visual-diff.mjs --threshold 0.002  # stricter run
 *
 * Exit codes: 0 pass, 1 fail, 2 usage error.
 */

import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VISUAL_DIR = path.join(SCRIPT_DIR, 'results', 'visual');
const BASELINE_DIR = path.join(SCRIPT_DIR, 'baselines');
const DIFF_DIR = path.join(VISUAL_DIR, 'diffs');

const DEFAULT_THRESHOLD = 0.005; // 0.5% of pixels

function parseArgs(argv) {
  const opts = { update: false, threshold: DEFAULT_THRESHOLD, states: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update-baselines') opts.update = true;
    else if (a === '--threshold') {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0 || v >= 1) {
        console.error(`Invalid --threshold: ${JSON.stringify(argv[i])}`);
        process.exit(2);
      }
      opts.threshold = v;
    } else if (a === '--help' || a === '-h') {
      console.log(helpText());
      process.exit(0);
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      opts.states.push(a);
    }
  }
  return opts;
}

function helpText() {
  return 'Usage: node e2e/visual-diff.mjs [--update-baselines] [--threshold <0..1>] [state ...]';
}

/** Pixel dimensions of a PNG file. */
async function pngSize(file) {
  const buf = await readFile(file);
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, png };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  await mkdir(VISUAL_DIR, { recursive: true });
  await mkdir(DIFF_DIR, { recursive: true });

  const shots = (await readdir(VISUAL_DIR, { withFileTypes: true }))
    .filter((d) => d.isFile() && d.name.endsWith('.png') && !d.name.endsWith('.diff.png'))
    .map((d) => d.name.slice(0, -4)) // strip .png
    .filter((s) => opts.states.length === 0 || opts.states.includes(s))
    .sort();

  if (shots.length === 0) {
    console.error(
      `No screenshots to process in ${VISUAL_DIR}.` +
        (opts.states.length ? ` Requested: ${opts.states.join(', ')}.` : '')
    );
    process.exit(2);
  }

  if (opts.update) {
    await mkdir(BASELINE_DIR, { recursive: true });
    for (const state of shots) {
      await copyFile(
        path.join(VISUAL_DIR, `${state}.png`),
        path.join(BASELINE_DIR, `${state}.png`)
      );
      console.log(`baseline updated: ${state}`);
    }
    console.log(`\n${shots.length} baseline(s) written to e2e/baselines/. Commit them with the lane changes.`);
    return;
  }

  let failures = 0;
  const report = [];

  for (const state of shots) {
    const current = path.join(VISUAL_DIR, `${state}.png`);
    const baseline = path.join(BASELINE_DIR, `${state}.png`);

    let baselinePng;
    try {
      baselinePng = await pngSize(baseline);
    } catch {
      console.warn(`WARN  ${state}: no baseline committed — pass with warning (capture a baseline before trusting this state)`);
      report.push({ state, status: 'warn', reason: 'missing baseline' });
      continue;
    }

    const curPng = await pngSize(current);
    if (curPng.width !== baselinePng.width || curPng.height !== baselinePng.height) {
      console.error(`FAIL  ${state}: size mismatch current ${curPng.width}x${curPng.height} vs baseline ${baselinePng.width}x${baselinePng.height}`);
      report.push({ state, status: 'fail', reason: 'size mismatch' });
      failures++;
      continue;
    }

    const diffPng = new PNG({ width: curPng.width, height: curPng.height });
    const diffPixels = pixelmatch(
      curPng.png.data,
      baselinePng.png.data,
      diffPng.data,
      curPng.width,
      curPng.height,
      { threshold: 0.1 } // pixelmatch perceptual threshold — ours is the area threshold below
    );
    const total = curPng.width * curPng.height;
    const ratio = diffPixels / total;
    const diffPath = path.join(DIFF_DIR, `${state}.diff.png`);

    if (ratio > opts.threshold) {
      await writeFile(diffPath, PNG.sync.write(diffPng));
      console.error(`FAIL  ${state}: ${(ratio * 100).toFixed(2)}% pixels differ (> ${(opts.threshold * 100).toFixed(1)}%) — diff: ${diffPath}`);
      report.push({ state, status: 'fail', ratio, diffPath });
      failures++;
    } else {
      console.log(`PASS  ${state}: ${(ratio * 100).toFixed(3)}% pixels differ`);
      report.push({ state, status: 'pass', ratio });
    }
  }

  const reportPath = path.join(VISUAL_DIR, 'report.json');
  await writeFile(reportPath, JSON.stringify({ threshold: opts.threshold, results: report }, null, 2));
  console.log(`\nreport: ${reportPath}`);

  if (failures > 0) {
    console.error(`\nvisual regression: ${failures} state(s) failed`);
    process.exit(1);
  }
  console.log('\nvisual regression: pass');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
