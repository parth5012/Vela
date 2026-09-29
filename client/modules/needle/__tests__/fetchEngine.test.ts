import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

/**
 * Tests for the needle engine fetch script (#293): manifest completeness,
 * SHA256 verification, corrupt-cache repair and cache-hit behaviour.
 * Network here is a loopback http server only — no external calls.
 */

const SCRIPT = path.resolve(__dirname, '../scripts/fetch-engine.js');
const LOCK = path.resolve(__dirname, '../scripts/engine.lock.json');

const MODELS = ['needle3', 'needle2'];
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'riscv64'];
const UPSTREAM_ABI: Record<string, string> = {
  'arm64-v8a': 'android-arm64',
  'armeabi-v7a': 'android-armv7',
  riscv64: 'android-riscv64',
};

interface LockEntry {
  model: string;
  abi: string;
  upstreamAbi: string;
  url: string;
  sha256: string;
  bytes: number;
}

jest.setTimeout(30000);

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function fixtureContent(model: string, abi: string): Buffer {
  return Buffer.from(`needle-engine-fixture:${model}:${abi}\n`);
}

function buildFixtureLock(baseUrl: string, corruptFor?: string): string {
  const engines: LockEntry[] = [];
  for (const model of MODELS) {
    for (const abi of ABIS) {
      const content = fixtureContent(model, abi);
      engines.push({
        model,
        abi,
        upstreamAbi: UPSTREAM_ABI[abi],
        url: `${baseUrl}/${model}/${abi}/libneedle.a`,
        sha256: corruptFor === `${model}/${abi}` ? 'f'.repeat(64) : sha256(content),
        bytes: content.length,
      });
    }
  }
  return JSON.stringify({ engines }, null, 2);
}

interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function spawnCollect(
  argv: string[],
  env: Record<string, string | undefined> = {}
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      timeout: 20000,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// Asynchronous spawn on purpose: a blocking spawnSync would freeze the jest
// event loop and dead-lock the loopback http server the script downloads from.
function runScript(args: string[], env: Record<string, string | undefined> = {}): Promise<ScriptResult> {
  return spawnCollect([SCRIPT, ...args], env);
}

function runNode(code: string, env: Record<string, string | undefined> = {}): Promise<ScriptResult> {
  return spawnCollect(['-e', code], env);
}

describe('fetch-engine.js', () => {
  let server: http.Server;
  let baseUrl = '';
  let requests: string[] = [];
  const tmpDirs: string[] = [];

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      requests.push(req.url || '');
      const match = /^\/(needle[23])\/([a-z0-9-]+)\/libneedle\.a$/.exec(req.url || '');
      if (!match) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const body = fixtureContent(match[1], match[2]);
      res.writeHead(200, { 'content-length': String(body.length) });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    server.close(() => done());
  });

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'needle-fetch-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  describe('committed engine.lock.json manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(LOCK, 'utf8')) as {
      engines: LockEntry[];
    };

    it('pins every model x abi combination exactly once', async () => {
      const keys = manifest.engines.map((e) => `${e.model}/${e.abi}`);
      const expected: string[] = [];
      for (const model of MODELS) {
        for (const abi of ABIS) expected.push(`${model}/${abi}`);
      }
      expect(keys.sort()).toEqual(expected.sort());
      expect(new Set(keys).size).toBe(6);
    });

    it('has a valid sha256, byte count and pinned https url per entry', async () => {
      for (const entry of manifest.engines) {
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(Number.isInteger(entry.bytes)).toBe(true);
        expect(entry.bytes).toBeGreaterThan(0);
        expect(entry.url).toMatch(/^https:\/\/huggingface\.co\//);
        expect(entry.upstreamAbi).toBe(UPSTREAM_ABI[entry.abi]);
        expect(entry.url).toContain(
          `/Cactus-Compute/${entry.model}/resolve/main/${entry.upstreamAbi}/libneedle.a`
        );
      }
    });
  });

  describe('download, verification and caching', () => {
    it('downloads a fresh archive and verifies it against the pin', async () => {
      const dest = makeTmpDir();
      const lockPath = path.join(dest, 'engine.lock.json');
      fs.writeFileSync(lockPath, buildFixtureLock(baseUrl));
      requests = [];

      const res = await runScript([
        '--lock', lockPath,
        '--dest', dest,
        '--model', 'needle3',
        '--abi', 'arm64-v8a',
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('(downloaded)');
      expect(requests).toHaveLength(1);
      const file = path.join(dest, 'needle3', 'arm64-v8a', 'libneedle.a');
      expect(fs.existsSync(file)).toBe(true);
      expect(sha256(fs.readFileSync(file))).toBe(
        sha256(fixtureContent('needle3', 'arm64-v8a'))
      );
    });

    it('second run is a cache hit and never touches the network', async () => {
      const dest = makeTmpDir();
      const lockPath = path.join(dest, 'engine.lock.json');
      fs.writeFileSync(lockPath, buildFixtureLock(baseUrl));
      const args = ['--lock', lockPath, '--dest', dest, '--model', 'needle3', '--abi', 'arm64-v8a'];

      expect((await runScript(args)).status).toBe(0);
      requests = [];
      const res = await runScript(args);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('(cached)');
      expect(requests).toHaveLength(0);
    });

    it('--force re-downloads even when the cache verifies', async () => {
      const dest = makeTmpDir();
      const lockPath = path.join(dest, 'engine.lock.json');
      fs.writeFileSync(lockPath, buildFixtureLock(baseUrl));
      const args = ['--lock', lockPath, '--dest', dest, '--model', 'needle3', '--abi', 'arm64-v8a'];

      expect((await runScript(args)).status).toBe(0);
      requests = [];
      const res = await runScript([...args, '--force']);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('(downloaded)');
      expect(requests).toHaveLength(1);
    });

    it('rejects a download whose bytes do not match the pinned sha256', async () => {
      const dest = makeTmpDir();
      const lockPath = path.join(dest, 'engine.lock.json');
      fs.writeFileSync(lockPath, buildFixtureLock(baseUrl, 'needle3/arm64-v8a'));
      requests = [];

      const res = await runScript([
        '--lock', lockPath,
        '--dest', dest,
        '--model', 'needle3',
        '--abi', 'arm64-v8a',
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain('checksum mismatch');
      const file = path.join(dest, 'needle3', 'arm64-v8a', 'libneedle.a');
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(`${file}.part`)).toBe(false);
      expect(requests).toHaveLength(1);
    });

    it('detects a corrupted cached archive, reports it and repairs from the network', async () => {
      const dest = makeTmpDir();
      const lockPath = path.join(dest, 'engine.lock.json');
      fs.writeFileSync(lockPath, buildFixtureLock(baseUrl));
      const args = ['--lock', lockPath, '--dest', dest, '--model', 'needle3', '--abi', 'arm64-v8a'];

      expect((await runScript(args)).status).toBe(0);
      const file = path.join(dest, 'needle3', 'arm64-v8a', 'libneedle.a');
      fs.writeFileSync(file, Buffer.from('corrupted on disk'));

      requests = [];
      const res = await runScript(args);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('failed verification');
      expect(res.stdout).toContain('(downloaded)');
      expect(requests).toHaveLength(1);
      expect(sha256(fs.readFileSync(file))).toBe(
        sha256(fixtureContent('needle3', 'arm64-v8a'))
      );
    });
  });

  describe('transport policy (review S1)', () => {
    it('rejects plain http manifests outside test mode unless NODE_ENV=test or --allow-http', async () => {
      const dest = makeTmpDir();
      const lockPath = path.join(dest, 'engine.lock.json');
      fs.writeFileSync(lockPath, buildFixtureLock(baseUrl));
      const args = ['--lock', lockPath, '--dest', dest, '--model', 'needle3', '--abi', 'arm64-v8a'];

      // Normal/configure-time environment: http must be refused outright,
      // before anything is downloaded or written.
      const rejected = await runScript(args, { NODE_ENV: 'production' });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain(
        'plain http is only allowed when NODE_ENV=test or --allow-http is passed'
      );
      expect(fs.existsSync(path.join(dest, 'needle3', 'arm64-v8a', 'libneedle.a'))).toBe(false);

      // Explicit test gate works in both directions.
      const testGate = await runScript(args, { NODE_ENV: 'test' });
      expect(testGate.status).toBe(0);

      const forced = await runScript([...args, '--allow-http'], { NODE_ENV: 'production' });
      expect(forced.status).toBe(0);
    });

    it('refuses an https→http redirect (no protocol downgrade, even in test mode)', async () => {
      // Exercises the exact predicate downloadTo() applies to every redirect.
      const code = `
        const m = require(${JSON.stringify(SCRIPT)});
        const checks = [
          ['https→http refused in test mode', m.isAllowedRedirect('https://huggingface.co/Cactus-Compute/needle3/resolve/main/x', 'http://127.0.0.1/steal', true) === false],
          ['https→http refused in normal mode', m.isAllowedRedirect('https://a.example/x', 'http://b.example/y', false) === false],
          ['https→https followed (HF CDN origin)', m.isAllowedRedirect('https://huggingface.co/a', 'https://us.aws.cdn.hf.co/b', true) === true],
          ['http loopback allowed only when gated', m.isAllowedRedirect('http://127.0.0.1/a', 'http://127.0.0.1/b', true) === true && m.isAllowedRedirect('http://127.0.0.1/a', 'http://127.0.0.1/b', false) === false],
        ];
        const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
        if (failed.length) {
          console.error('FAILED: ' + failed.join('; '));
          process.exit(1);
        }
        console.log('redirect policy ok (' + checks.length + ' checks)');
      `;
      const res = await runNode(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('redirect policy ok');
    });
  });

  describe('cli validation', () => {
    it('fails usage with exit 2 on an unknown abi', async () => {
      const res = await runScript(['--abi', 'x86_64']);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('unknown --abi');
    });

    it('fails usage with exit 2 on an unknown argument', async () => {
      const res = await runScript(['--nope']);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('unknown argument');
    });
  });
});
