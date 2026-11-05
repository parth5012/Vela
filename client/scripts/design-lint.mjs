#!/usr/bin/env node
/**
 * Scroll-craft design guardrail (WF-447-05 / wayfinder #452).
 *
 * The mechanical half of the taste floor codified in docs/DESIGN.md. Scans the
 * React Native sources for refuse-list patterns that can be caught statically;
 * error-level findings fail CI, warnings only print. Behavioural and motion
 * invariants stay in __tests__/motion.test.ts (the ease-in checks here are
 * belt-and-braces with its source audit).
 *
 * Scanned by default (relative to client/): app/, components/, styles/ and
 * utils/theme.ts. __tests__ is never scanned, so the deliberately-bad
 * fixtures under __tests__/fixtures/design-lint stay out of real runs — point
 * the script at them explicitly with --root to exercise it.
 *
 * Usage:
 *   node scripts/design-lint.mjs [--root <dir>] [--allowlist <file>] [--json]
 *   DESIGN_LINT_ROOT=<dir> node scripts/design-lint.mjs --json
 *
 * Allowlist (scripts/design-lint-allowlist.json): an array of
 *   { "file": "app/foo.tsx", "rule": "<rule id>", "reason": "why this exists" }
 * Entries suppress every finding of that rule in that file. An entry without
 * a non-empty `reason` (or with an unknown `rule`) fails the lint, so every
 * exception stays documented.
 *
 * Exit codes: 0 = clean (warnings allowed), 1 = errors found or the allowlist
 * itself is invalid.
 *
 * Note: this is a scanner, not a JS parser — a small lexer blanks comments and
 * extracts string literals, tuned for this codebase's style. No dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const ROOT = path.resolve(
  argValue('--root') || process.env.DESIGN_LINT_ROOT || DEFAULT_ROOT
);
const ALLOWLIST_PATH = path.resolve(
  argValue('--allowlist') || path.join(SCRIPT_DIR, 'design-lint-allowlist.json')
);
const AS_JSON = argv.includes('--json');

/** Dirs walked recursively, plus the single token file under utils/. */
const SCAN_DIRS = ['app', 'components', 'styles'];
const SCAN_FILES = ['utils/theme.ts'];
const SCAN_EXT = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '__tests__']);

// ── Lexer ────────────────────────────────────────────────────────────────────
/**
 * Returns { code, codeNoStrings, strings }.
 *
 * - `code`: source with comment text blanked, string literals intact — used
 *   for prop-value patterns that span the code/string seam (e.g.
 *   `backgroundColor: '#000000'`, `transition: 'all'`).
 * - `codeNoStrings`: comments AND string literals blanked — used for bare
 *   code tokens (Easing.in(, MaskedView, …) so prose never triggers them.
 * - `strings`: every quoted/template raw chunk as { text, line }.
 *
 * Blanking preserves offsets and newlines, so match indices map back to the
 * original source for line numbers.
 */
function lex(source) {
  const n = source.length;
  const commentRanges = [];
  const stringRanges = [];
  const strings = [];

  const lineAt = (idx) => {
    let line = 1;
    for (let i = 0; i < idx && i < n; i++) if (source[i] === '\n') line++;
    return line;
  };

  // Index just past the closing quote of a quoted literal (or the newline/EOL
  // when unterminated). Handles escapes.
  function readQuoted(start, end) {
    let i = start + 1;
    while (i < end) {
      const c = source[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') return i;
      if (c === source[start]) return i + 1;
      i++;
    }
    return i;
  }

  // Template literal: records the whole template region as one string range
  // and its raw text chunks as strings; interpolation interiors are live code
  // and are scanned recursively (nested strings/comments/templates handled).
  function readTemplate(start, end) {
    const line = lineAt(start);
    const pushChunk = (from, to) => {
      if (to > from) {
        const text = source.slice(from, to).replace(/\\(.)/g, '$1');
        if (text.trim().length > 0) strings.push({ text, line });
      }
    };
    let i = start + 1;
    let chunkStart = i;
    while (i < end) {
      const c = source[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') {
        pushChunk(chunkStart, i);
        stringRanges.push([start, i + 1]);
        return i + 1;
      }
      if (c === '$' && source[i + 1] === '{') {
        pushChunk(chunkStart, i);
        let depth = 1;
        let j = i + 2;
        while (j < end) {
          const d = source[j];
          if (d === '{') { depth++; j++; continue; }
          if (d === '}') { depth--; if (depth === 0) break; j++; continue; }
          if (d === "'" || d === '"') { j = readQuoted(j, end); continue; }
          if (d === '`') { j = readTemplate(j, end); continue; }
          if (d === '/' && source[j + 1] === '/') {
            const nl = source.indexOf('\n', j);
            j = nl === -1 ? end : Math.min(nl, end);
            continue;
          }
          if (d === '/' && source[j + 1] === '*') {
            const close = source.indexOf('*/', j + 2);
            j = close === -1 ? end : Math.min(close + 2, end);
            continue;
          }
          j++;
        }
        scanExpression(i + 2, j);
        i = j + 1;
        chunkStart = i;
        continue;
      }
      i++;
    }
    pushChunk(chunkStart, i);
    stringRanges.push([start, i]);
    return i;
  }

  function scanExpression(start, end) {
    let i = start;
    while (i < end) {
      const c = source[i];
      const c2 = source[i + 1];
      if (c === '/' && c2 === '/') {
        const nl = source.indexOf('\n', i);
        const stop = nl === -1 ? end : Math.min(nl, end);
        commentRanges.push([i, stop]);
        i = stop;
        continue;
      }
      if (c === '/' && c2 === '*') {
        const close = source.indexOf('*/', i + 2);
        const stop = close === -1 ? end : Math.min(close + 2, end);
        commentRanges.push([i, stop]);
        i = stop;
        continue;
      }
      if (c === "'" || c === '"') {
        const litEnd = readQuoted(i, end);
        const text = source.slice(i + 1, Math.min(litEnd - 1, end)).replace(/\\(.)/g, '$1');
        if (text.length > 0) strings.push({ text, line: lineAt(i) });
        stringRanges.push([i, litEnd]);
        i = litEnd;
        continue;
      }
      if (c === '`') { i = readTemplate(i, end); continue; }
      i++;
    }
  }

  scanExpression(0, n);

  const blankRanges = (ranges) => {
    const arr = source.split('');
    for (const [from, to] of ranges) {
      for (let i = from; i < to && i < arr.length; i++) {
        if (arr[i] !== '\n') arr[i] = ' ';
      }
    }
    return arr.join('');
  };

  return {
    code: blankRanges(commentRanges),
    codeNoStrings: blankRanges(commentRanges.concat(stringRanges)),
    strings,
  };
}

// ── Colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [0, 1, 2].map((i) => parseInt(clean[i] + clean[i], 16));
  }
  if (clean.length >= 6) {
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  }
  return null;
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/**
 * Parse a colour literal (hex or rgb/rgba()) into {s,l,a}, or null when the
 * literal is not statically resolvable (theme tokens are skipped, not guessed).
 */
function parseColorLiteral(raw) {
  const value = raw.trim().toLowerCase();
  let rgb = null;
  let a = 1;
  if (value.startsWith('#')) {
    rgb = hexToRgb(value);
  } else {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
    if (m) {
      rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (m[4] !== undefined) a = Number(m[4]);
    }
  }
  if (!rgb || rgb.some((v) => Number.isNaN(v))) return null;
  const { s, l } = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return { s, l, a };
}

// A "bright hue": saturated and light enough to read as neon. Faint glows
// (alpha < 0.35) and desaturated shadows never qualify.
const NEON_MIN_SATURATION = 0.5;
const NEON_MIN_LIGHTNESS = 0.4;
const NEON_MIN_ALPHA = 0.35;
function isNeon(color) {
  return (
    color !== null &&
    color.a >= NEON_MIN_ALPHA &&
    color.s >= NEON_MIN_SATURATION &&
    color.l >= NEON_MIN_LIGHTNESS
  );
}

// ── Rules ────────────────────────────────────────────────────────────────────
const RULES = [
  {
    id: 'no-pure-black-background',
    severity: 'error',
    describe: "background/backgroundColor set to '#000' or '#000000' — grounds are tinted, never pure black",
  },
  {
    id: 'no-black-shadow',
    severity: 'error',
    describe: "shadowColor '#000'/'#000000' — shadows are tinted to the canvas hue via utils/elevation.ts",
  },
  {
    id: 'no-ease-in',
    severity: 'error',
    describe: "Easing.in( or 'ease-in' — ease-out curves only (mirrors __tests__/motion.test.ts)",
  },
  {
    id: 'no-transition-all',
    severity: 'error',
    describe: "transition: 'all' — transitions name the property they animate",
  },
  {
    id: 'no-neon-glow-text',
    severity: 'error',
    describe: 'textShadowRadius > 0 with a bright saturated textShadowColor — glowing text is refused',
  },
  {
    id: 'no-gradient-text',
    severity: 'error',
    describe: 'MaskedView + LinearGradient in one file — the masked-gradient fill recipe (gradient text)',
  },
  {
    id: 'emoji-standalone-label',
    severity: 'warn',
    describe: 'emoji as a standalone label/icon slot — use text labels or a real icon set',
  },
  {
    id: 'copy-filler-verb',
    severity: 'warn',
    describe: 'filler verbs in string copy: elevate/seamless/unleash/next-gen/revolutionize/supercharge',
  },
  {
    id: 'copy-em-dash',
    severity: 'warn',
    describe: 'em dash (—) inside a string literal — user-facing copy prefers period or comma',
  },
  {
    id: 'left-border-overkill',
    severity: 'warn',
    describe: 'borderLeftWidth > 1 — left accent bars on cards are refused',
  },
];
const SEVERITY_OF = Object.fromEntries(RULES.map((r) => [r.id, r.severity]));
const RULE_IDS = new Set(RULES.map((r) => r.id));

// Emoji alphabet for the standalone-label warn: pictographic blocks plus the
// misc-symbols block (⚙ ⚡ ☁ ⚠ …). Typographic glyphs (✓ ✕ ◀ ▶ ⟳) are excluded
// — they are text glyphs, not emoji.
const EMOJI_CLASS = '[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{26FF}]';
const HAS_EMOJI = new RegExp(EMOJI_CLASS, 'u');
const EMOJI_NODE_CONTENT = `(?:\\s|${EMOJI_CLASS}|\\u{FE0F}|\\u{200D})`;
const EMOJI_ONLY = new RegExp(`^${EMOJI_NODE_CONTENT}+$`, 'u');
// Standalone emoji as the entire JSX text node. Matches between tags include
// formatting whitespace, so every match is post-filtered to require emoji.
const JSX_EMOJI_NODE = new RegExp(`>(${EMOJI_NODE_CONTENT}+)<`, 'gu');

const PURE_BLACK_BG = /background(?:Color)?\s*:\s*(['"])#(?:000000|000)\1/g;
const PURE_BLACK_SHADOW = /shadowColor\s*:\s*(['"])#(?:000000|000)\1/g;
const BANNED_CURVE_API = /Easing\.in\s*\(/g;
const TRANSITION_ALL = /transition\s*:\s*(['"])all\b\1?/g;
const TEXT_SHADOW_RADIUS = /textShadowRadius\s*:\s*(\d+(?:\.\d+)?)/g;
const TEXT_SHADOW_COLOR = /textShadowColor\s*:\s*(['"])([^'"]+)\1/g;
const LEFT_BORDER = /borderLeftWidth\s*:\s*(\d+(?:\.\d+)?)/g;
// Marketing filler — verb/noun-adjective forms only; the RN `elevation` style
// prop (and `utils/elevation` import paths) must never trip this.
const FILLER_VERB = /\b(elevate|elevates|elevated|elevating|seamless|seamlessly|unleash|unleashes|unleashing|next-gen|nextgen|revolutionize|revolutionizes|revolutionized|revolutionizing|revolutionary|supercharge|supercharges|supercharged|supercharging)\b/gi;
const LINE_OF = (code, idx) => code.slice(0, idx).split('\n').length;

/** Scan one file; returns unsuppressed findings. */
function scanFile(absPath, relPath) {
  const source = fs.readFileSync(absPath, 'utf8');
  const { code, codeNoStrings, strings } = lex(source);
  const findings = [];
  const add = (rule, line, message) =>
    findings.push({ rule, severity: SEVERITY_OF[rule], file: relPath, line, message });

  // Prop-value patterns whose value is a literal — matched on `code` so the
  // pattern can span the code/string seam.
  for (const m of code.matchAll(PURE_BLACK_BG)) {
    add('no-pure-black-background', LINE_OF(code, m.index), `pure black ground '${m[0].trim().slice(0, 40)}'`);
  }
  for (const m of code.matchAll(PURE_BLACK_SHADOW)) {
    add('no-black-shadow', LINE_OF(code, m.index), `black shadow '${m[0].trim().slice(0, 40)}'`);
  }
  for (const m of code.matchAll(TRANSITION_ALL)) {
    add('no-transition-all', LINE_OF(code, m.index), `'${m[0].trim().slice(0, 40)}' animates everything`);
  }

  // Banned easing: the curve API as bare code, the curve name inside any
  // string literal (values or prose) — mirrors motion.test.ts's audit, minus
  // comments.
  for (const m of codeNoStrings.matchAll(BANNED_CURVE_API)) {
    add('no-ease-in', LINE_OF(code, m.index), `${m[0].trim()} accelerates — use EASING.out`);
  }
  for (const s of strings) {
    if (/\bease-in\b/.test(s.text)) {
      add('no-ease-in', s.line, `'ease-in' inside a string literal — use EASING.out`);
    }
  }

  // no-neon-glow-text — pair each non-zero textShadowRadius with the nearest
  // textShadowColor literal inside a small window; unresolvable colours skip.
  const radii = [...code.matchAll(TEXT_SHADOW_RADIUS)];
  const colors = [...code.matchAll(TEXT_SHADOW_COLOR)];
  for (const r of radii) {
    if (Number(r[1]) <= 0) continue;
    const near = colors
      .map((c) => ({ c, dist: Math.abs(c.index - r.index) }))
      .filter((x) => x.dist < 300)
      .sort((a, b) => a.dist - b.dist)[0];
    if (!near) continue;
    const color = parseColorLiteral(near.c[2]);
    if (isNeon(color)) {
      add(
        'no-neon-glow-text',
        LINE_OF(code, r.index),
        `glowing text: textShadowRadius ${r[1]} with neon textShadowColor '${near.c[2]}'`
      );
    }
  }

  // no-gradient-text — the MaskedView(mask) + LinearGradient(fill) recipe.
  if (/\bMaskedView\b/.test(codeNoStrings) && /\bLinearGradient\b/.test(codeNoStrings)) {
    add('no-gradient-text', 1, 'MaskedView + LinearGradient — gradient-filled text recipe');
  }

  // String-literal copy rules (comments never count).
  for (const s of strings) {
    if (HAS_EMOJI.test(s.text) && EMOJI_ONLY.test(s.text)) {
      add('emoji-standalone-label', s.line, `emoji-only string '${s.text.trim()}' used as a label/icon slot`);
    }
    for (const m of s.text.matchAll(FILLER_VERB)) {
      add('copy-filler-verb', s.line, `filler verb '${m[0]}' in copy`);
    }
    if (s.text.includes('\u2014')) {
      add('copy-em-dash', s.line, 'em dash in string copy');
    }
  }

  // Standalone emoji as JSX text (not a string literal).
  for (const m of code.matchAll(JSX_EMOJI_NODE)) {
    if (!HAS_EMOJI.test(m[1])) continue; // skip inter-tag formatting whitespace
    add('emoji-standalone-label', LINE_OF(code, m.index), `standalone emoji label '${m[1].trim()}'`);
  }

  // left-border-overkill — borderLeftWidth > 1.
  for (const m of code.matchAll(LEFT_BORDER)) {
    if (Number(m[1]) > 1) {
      add('left-border-overkill', LINE_OF(code, m.index), `borderLeftWidth ${m[1]} — card accent bars refused`);
    }
  }

  return findings;
}

/** Walk the scan roots; returns [{ abs, rel }] of .ts/.tsx files. */
function collectFiles() {
  const files = [];
  const walk = (dir, relBase) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (SCAN_EXT.test(entry.name)) files.push({ abs, rel });
    }
  };
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, dir);
  }
  for (const file of SCAN_FILES) {
    const abs = path.join(ROOT, file);
    if (fs.existsSync(abs)) files.push({ abs, rel: file });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ── Allowlist ────────────────────────────────────────────────────────────────
/** Returns { entries, invalid } — invalid entries fail the lint. */
function loadAllowlist() {
  const result = { entries: [], invalid: [] };
  if (!fs.existsSync(ALLOWLIST_PATH)) return result;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  } catch (e) {
    result.invalid.push(`allowlist is not valid JSON: ${e.message}`);
    return result;
  }
  if (!Array.isArray(raw)) {
    result.invalid.push('allowlist must be a JSON array of { file, rule, reason }');
    return result;
  }
  raw.forEach((entry, i) => {
    const where = `allowlist entry ${i + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      result.invalid.push(`${where} is not an object`);
      return;
    }
    if (typeof entry.file !== 'string' || entry.file.length === 0) {
      result.invalid.push(`${where} is missing "file"`);
      return;
    }
    if (typeof entry.rule !== 'string' || !RULE_IDS.has(entry.rule)) {
      result.invalid.push(`${where} (${entry.file}) has unknown rule "${entry.rule}"`);
      return;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      result.invalid.push(`${where} (${entry.file}, ${entry.rule}) is missing a "reason" — every exception must be documented`);
      return;
    }
    result.entries.push({ file: entry.file.replace(/\\/g, '/'), rule: entry.rule });
  });
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files = collectFiles();
const allowlist = loadAllowlist();
const isAllowlisted = (f) =>
  allowlist.entries.some((e) => e.file === f.file && e.rule === f.rule);

const allFindings = [];
for (const { abs, rel } of files) {
  allFindings.push(...scanFile(abs, rel));
}

const usedEntries = new Set();
const suppressed = [];
const unsuppressed = allFindings.filter((f) => {
  if (!isAllowlisted(f)) return true;
  usedEntries.add(`${f.file}|${f.rule}`);
  suppressed.push(f);
  return false;
});

const errors = unsuppressed.filter((f) => f.severity === 'error');
const warnings = unsuppressed.filter((f) => f.severity === 'warn');
const unusedEntries = allowlist.entries
  .filter((e) => !usedEntries.has(`${e.file}|${e.rule}`))
  .map((e) => `${e.file} (${e.rule})`);

const report = {
  root: ROOT,
  filesScanned: files.length,
  errors,
  warnings,
  allowlist: { invalid: allowlist.invalid, unused: unusedEntries, suppressed: suppressed.length },
  summary: { errors: errors.length, warnings: warnings.length },
};

const ok = errors.length === 0 && allowlist.invalid.length === 0;

// Invalid allowlist entries are loud in both modes.
for (const inv of allowlist.invalid) console.error(`design-lint: ${inv}`);

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const scanDesc = `${files.length} file${files.length === 1 ? '' : 's'} under ${SCAN_DIRS.join(', ')} + ${SCAN_FILES.join(', ')}`;
  console.log(`design-lint: scanned ${scanDesc} (root: ${path.relative(process.cwd(), ROOT) || '.'})`);
  if (errors.length > 0) {
    console.log(`\nERRORS (${errors.length}) — refuse-list violations; fix or allowlist with a reason:`);
    for (const f of errors) console.log(`  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
  }
  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}) — visible, non-blocking:`);
    for (const f of warnings) console.log(`  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
  }
  if (suppressed.length > 0) {
    console.log(`\nAllowlisted (documented exceptions): ${suppressed.length} finding(s) suppressed`);
  }
  if (unusedEntries.length > 0) {
    console.log('\nUnused allowlist entries (nothing matched — consider removing):');
    for (const u of unusedEntries) console.log(`  ${u}`);
  }
  console.log(
    ok
      ? `\ndesign-lint: OK (${errors.length} errors, ${warnings.length} warnings)`
      : `\ndesign-lint: FAILED (${errors.length} error(s), ${allowlist.invalid.length} allowlist problem(s)) — see docs/DESIGN.md refuse list`
  );
}

process.exit(ok ? 0 : 1);
