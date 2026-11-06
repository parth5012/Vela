/**
 * WF-447-05 design-lint guardrail tests.
 *
 * Runs scripts/design-lint.mjs as a child process against the deliberately-bad
 * fixture tree in __tests__/fixtures/design-lint (the real scan never sees
 * __tests__) and asserts the expected error/warn counts, allowlist
 * suppression, and the reason-required allowlist rule. The final test runs the
 * lint against the real client tree: the repo itself must be clean — the DoD
 * "design:lint passes on the repo" encoded as a test.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CLIENT_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(CLIENT_ROOT, 'scripts', 'design-lint.mjs');
const FIXTURE_ROOT = path.join(CLIENT_ROOT, '__tests__', 'fixtures', 'design-lint');
const FIXTURE_ALLOWLIST = path.join(FIXTURE_ROOT, 'allowlist.json');
const FIXTURE_ALLOWLIST_NO_REASON = path.join(FIXTURE_ROOT, 'allowlist-no-reason.json');

interface Finding {
  rule: string;
  severity: string;
  file: string;
  line: number;
  message: string;
}

interface LintReport {
  root: string;
  filesScanned: number;
  errors: Finding[];
  warnings: Finding[];
  allowlist: { invalid: string[]; unused: string[]; suppressed: number };
  summary: { errors: number; warnings: number };
}

interface LintResult {
  status: number;
  report: LintReport | null;
  output: string;
}

function runLint(opts: { root?: string; allowlist?: string } = {}): LintResult {
  const args = [SCRIPT, '--json'];
  if (opts.root) args.push('--root', opts.root);
  if (opts.allowlist) args.push('--allowlist', opts.allowlist);
  const res = spawnSync('node', args, { encoding: 'utf8' });
  let report: LintReport | null = null;
  try {
    report = JSON.parse(res.stdout) as LintReport;
  } catch {
    // Non-JSON output (crash) — surfaced via assertions on output.
  }
  return { status: res.status ?? -1, report, output: `${res.stdout}\n${res.stderr}` };
}

const count = (list: Finding[], rule: string): number =>
  list.filter((f) => f.rule === rule).length;

describe('design-lint fixtures (WF-447-05)', () => {
  it('reports every refuse-list error with the expected per-rule counts', () => {
    const { status, report } = runLint({ root: FIXTURE_ROOT });
    expect(report).not.toBeNull();
    expect(status).toBe(1);
    expect(report!.summary.errors).toBe(8);
    expect(count(report!.errors, 'no-pure-black-background')).toBe(1);
    expect(count(report!.errors, 'no-black-shadow')).toBe(1);
    expect(count(report!.errors, 'no-neon-glow-text')).toBe(1);
    expect(count(report!.errors, 'no-gradient-text')).toBe(1);
    expect(count(report!.errors, 'no-ease-in')).toBe(3);
    expect(count(report!.errors, 'no-transition-all')).toBe(1);
  });

  it('reports the expected warn counts without failing on them', () => {
    const { report } = runLint({ root: FIXTURE_ROOT });
    expect(report!.summary.warnings).toBe(5);
    expect(count(report!.warnings, 'copy-filler-verb')).toBe(2);
    expect(count(report!.warnings, 'copy-em-dash')).toBe(1);
    expect(count(report!.warnings, 'emoji-standalone-label')).toBe(1);
    expect(count(report!.warnings, 'left-border-overkill')).toBe(1);
  });

  it('never fires on comments — banned values documented in comments are ignored', () => {
    const { report } = runLint({ root: FIXTURE_ROOT });
    const themeFindings = [...report!.errors, ...report!.warnings].filter(
      (f) => f.file === 'utils/theme.ts'
    );
    expect(themeFindings).toEqual([]);
  });

  it('exits clean once every error is allowlisted with a reason, warnings intact', () => {
    const { status, report } = runLint({
      root: FIXTURE_ROOT,
      allowlist: FIXTURE_ALLOWLIST,
    });
    expect(status).toBe(0);
    expect(report!.summary.errors).toBe(0);
    expect(report!.summary.warnings).toBe(5);
    expect(report!.allowlist.suppressed).toBe(8);
    expect(report!.allowlist.invalid).toEqual([]);
    expect(report!.allowlist.unused).toEqual([]);
  });

  it('fails the lint when an allowlist entry has no reason', () => {
    const { status, report, output } = runLint({
      root: FIXTURE_ROOT,
      allowlist: FIXTURE_ALLOWLIST_NO_REASON,
    });
    expect(status).toBe(1);
    expect(report!.allowlist.invalid.length).toBeGreaterThan(0);
    expect(report!.allowlist.invalid[0]).toMatch(/missing a "reason"/);
    expect(output).toMatch(/missing a "reason"/);
  });
});

describe('design-lint on the real client tree (WF-447-05)', () => {
  it('passes on the repo: zero error-level findings, no allowlist problems', () => {
    const { status, report } = runLint({ root: CLIENT_ROOT });
    expect(report).not.toBeNull();
    expect(report!.filesScanned).toBeGreaterThan(0);
    expect(report!.errors).toEqual([]);
    expect(report!.allowlist.invalid).toEqual([]);
    expect(status).toBe(0);
  });

  it('never scans __tests__ — fixtures stay out of real runs', () => {
    const { report } = runLint({ root: CLIENT_ROOT });
    const scannedFiles = [...report!.errors, ...report!.warnings].map((f) => f.file);
    expect(scannedFiles.some((f) => f.includes('__tests__'))).toBe(false);
  });
});
