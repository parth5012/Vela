/**
 * Standalone test-runner shim + source-extraction helpers.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm test` (jest-expo) currently cannot bootstrap ANY suite in this
 * environment: @react-native/jest-preset/setup.js dies with
 * "SyntaxError: Cannot use import statement outside a module" because pnpm's
 * `.pnpm` store layout is not matched by the `transformIgnorePatterns` regex
 * in package.json. Fixing that requires package.json / jest-config changes,
 * which are out of scope for the #158/#160 ship batch (pre-existing breakage,
 * proven on a pristine tree via git stash).
 *
 * Tests that use this helper therefore run in BOTH worlds:
 *  - Under Jest (once infra is fixed): `ensureStandaloneRunner()` detects the
 *    Jest globals and does nothing; Jest's own lifecycle and reporter apply.
 *  - Standalone (`tsc --module commonjs` + plain `node`): the shim installs a
 *    minimal describe/it/expect, runs the tests, prints PASS/FAIL totals and
 *    sets a non-zero exit code on failure.
 *
 * It also provides extractBlock()/transpileAndEval(), used to exercise REAL
 * production code that cannot simply be imported in Node:
 *  - deriveSafetyTier() lives in app/index.tsx, whose module graph drags in
 *    react-native/expo — unloadable outside a RN runtime.
 *  - classifyAction() sits in utils/safetyManager.ts which imports the config
 *    store (zustand v5 is ESM-only, AsyncStorage/SecureStore are native).
 *  - shouldPrompt() sits in utils/permissionManager.ts which imports
 *    react-native and expo-notifications at module top level.
 * Extraction pulls the exact function text out of the real source files at
 * runtime, transpiles it with the project's own TypeScript compiler, and
 * evaluates it in a sandbox where ONLY the external dependencies are stubbed.
 */

import { inspect, isDeepStrictEqual } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as TypeScript from 'typescript';

// ---------------------------------------------------------------------------
// Minimal Jest-compatible runner
// ---------------------------------------------------------------------------

interface RecordedTest {
  suitePath: string[];
  name: string;
  error?: string;
}

const runnerState = {
  installed: false,
  reported: false,
  suiteStack: [] as string[],
  results: [] as RecordedTest[],
};

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return inspect(value, { depth: 4, breakLength: 120 });
  } catch {
    return String(value);
  }
}

class Expectation {
  private readonly actual: unknown;
  private readonly negated: boolean;

  constructor(actual: unknown, negated = false) {
    this.actual = actual;
    this.negated = negated;
  }

  get not(): Expectation {
    return new Expectation(this.actual, !this.negated);
  }

  private check(pass: boolean, matcherName: string, detail: string): void {
    const ok = this.negated ? !pass : pass;
    if (!ok) {
      throw new Error(
        `expect(${formatValue(this.actual)}).${this.negated ? 'not.' : ''}${matcherName} — ${detail}`
      );
    }
  }

  toBe(expected: unknown): void {
    this.check(Object.is(this.actual, expected), 'toBe', `expected ${formatValue(expected)}`);
  }

  toEqual(expected: unknown): void {
    let pass = false;
    try {
      pass = isDeepStrictEqual(this.actual, expected);
    } catch {
      pass = false;
    }
    this.check(pass, 'toEqual', `expected ${formatValue(expected)}`);
  }

  toHaveLength(expected: number): void {
    const length =
      typeof this.actual === 'string' || Array.isArray(this.actual) ? this.actual.length : undefined;
    this.check(
      length === expected,
      'toHaveLength',
      `expected length ${expected}, received ${formatValue(length)}`
    );
  }

  toContain(fragment: unknown): void {
    let pass = false;
    if (typeof this.actual === 'string') pass = this.actual.includes(String(fragment));
    else if (Array.isArray(this.actual)) pass = this.actual.includes(fragment);
    this.check(pass, 'toContain', `expected to contain ${formatValue(fragment)}`);
  }

  toMatch(pattern: RegExp | string): void {
    const subject = String(this.actual);
    const pass =
      typeof pattern === 'string' ? subject.includes(pattern) : pattern.test(subject);
    this.check(pass, 'toMatch', `expected to match ${String(pattern)}`);
  }

  toBeDefined(): void {
    this.check(this.actual !== undefined, 'toBeDefined', 'expected a defined value');
  }

  toBeUndefined(): void {
    this.check(this.actual === undefined, 'toBeUndefined', 'expected an undefined value');
  }

  toBeGreaterThan(expected: number): void {
    this.check(
      typeof this.actual === 'number' && this.actual > expected,
      'toBeGreaterThan',
      `expected a number greater than ${expected}, received ${formatValue(this.actual)}`
    );
  }

  toBeLessThan(expected: number): void {
    this.check(
      typeof this.actual === 'number' && this.actual < expected,
      'toBeLessThan',
      `expected a number less than ${expected}, received ${formatValue(this.actual)}`
    );
  }
}

function record(suitePath: string[], name: string, error?: string): void {
  runnerState.results.push({ suitePath, name, error });
}

function describeImpl(name: string, body: () => void): void {
  runnerState.suiteStack.push(name);
  try {
    body();
  } finally {
    runnerState.suiteStack.pop();
  }
}

function itImpl(name: string, body: () => void | Promise<void>): void {
  const suitePath = [...runnerState.suiteStack];
  try {
    const outcome = body();
    if (
      outcome &&
      typeof (outcome as Promise<void>).then === 'function'
    ) {
      (outcome as Promise<void>).then(
        () => record(suitePath, name),
        (err: unknown) =>
          record(suitePath, name, err instanceof Error ? err.message : String(err))
      );
    } else {
      record(suitePath, name);
    }
  } catch (err) {
    record(suitePath, name, err instanceof Error ? err.message : String(err));
  }
}

function reportResults(): void {
  if (runnerState.reported) return;
  runnerState.reported = true;
  let passed = 0;
  const failures: string[] = [];
  for (const result of runnerState.results) {
    if (result.error) {
      failures.push(`FAIL ${[...result.suitePath, result.name].join(' > ')}\n      ${result.error}`);
    } else {
      passed += 1;
    }
  }
  for (const failure of failures) console.log(failure);
  console.log(
    `\nStandalone results: PASS ${passed} / FAIL ${failures.length} / TOTAL ${runnerState.results.length}`
  );
  if (failures.length > 0) process.exitCode = 1;
}

/**
 * Installs the minimal runner when Jest globals are absent.
 * Returns true when running standalone, false under Jest (no-op there).
 */
export function ensureStandaloneRunner(): boolean {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (
    typeof globals.describe === 'function' &&
    typeof globals.it === 'function' &&
    typeof globals.expect === 'function'
  ) {
    return false;
  }
  if (runnerState.installed) return true;
  runnerState.installed = true;
  globals.describe = describeImpl;
  globals.it = itImpl;
  globals.expect = (actual: unknown) => new Expectation(actual);
  // Async test bodies settle in microtasks, which always flush before timers.
  setTimeout(reportResults, 0);
  return true;
}

// ---------------------------------------------------------------------------
// Source extraction + runtime transpile/eval
// ---------------------------------------------------------------------------

/**
 * Extracts a brace-balanced block starting at `startMarker` (e.g.
 * "function deriveSafetyTier"). Handles strings, template literals, escapes
 * and comments so braces inside literals never confuse the scan.
 *
 * The opening brace is searched from the marker START, so markers may either
 * be a plain declaration ("function foo") or include the brace themselves
 * ("deviceAgentPermissions: {"). None of the targeted signatures contain
 * braces before their body, so this single rule covers both shapes.
 */
export function extractBlock(source: string, startMarker: string): string {
  const markerIdx = source.indexOf(startMarker);
  if (markerIdx === -1) {
    throw new Error(`extractBlock: marker not found: "${startMarker}"`);
  }
  const openIdx = source.indexOf('{', markerIdx);
  if (openIdx === -1) {
    throw new Error(`extractBlock: no '{' after marker "${startMarker}"`);
  }

  let depth = 0;
  let i = openIdx;
  let inString: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      const newline = source.indexOf('\n', i);
      i = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(markerIdx, i + 1);
    }
    i += 1;
  }
  throw new Error(`extractBlock: unbalanced braces for marker "${startMarker}"`);
}

/**
 * Transpiles a TS source string with the project's own TypeScript compiler
 * and evaluates it as CommonJS inside a vm sandbox. The sandbox provides only
 * `module`/`exports` plus a `require` that throws, so any accidental external
 * dependency fails loudly instead of silently passing.
 */
export function transpileAndEval(tsSource: string): Record<string, unknown> {
  const transpiled = TypeScript.transpileModule(tsSource, {
    compilerOptions: {
      module: TypeScript.ModuleKind.CommonJS,
      target: TypeScript.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: 'extracted-module.ts',
  });

  const moduleObj = { exports: {} as Record<string, unknown> };
  const sandbox: Record<string, unknown> = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: (id: string) => {
      throw new Error(
        `extracted module attempted require("${id}") — external dependencies must be injected instead`
      );
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: 'extracted-module.js' });
  return moduleObj.exports;
}

/**
 * Locates the client/ root regardless of whether the compiled test runs from
 * the repo or from a temp build directory. Checks VELA_CLIENT_ROOT, then the
 * current working directory, then __dirname ancestors.
 */
export function findClientRoot(): string {
  const candidates: string[] = [];
  if (process.env.VELA_CLIENT_ROOT) candidates.push(process.env.VELA_CLIENT_ROOT);
  candidates.push(process.cwd());
  let dir = __dirname;
  for (;;) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'app', 'index.tsx')) &&
      fs.existsSync(path.join(candidate, 'utils', 'messageParser.ts'))
    ) {
      return candidate;
    }
  }
  throw new Error(
    'Could not locate the client/ root. Run node from client/ or set VELA_CLIENT_ROOT.'
  );
}

/** Reads a repo source file relative to the client/ root. */
export function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(findClientRoot(), relativePath), 'utf8');
}
