#!/usr/bin/env node
'use strict';

/**
 * fetch-engine.js — downloads the pinned static needle engine archives.
 *
 * Wayfinder #293 (decision: fetch-at-build, pinned URLs + SHA256; no binaries
 * are committed — see docs/decisions.md "needle engine vendoring").
 *
 * Upstream (Cactus Compute) ships ONLY static per-ABI `libneedle.a` archives —
 * there is no `libneedle.so` anywhere — so the engine is fetched into the
 * gitignored `android/engine/<model>/<abi>/libneedle.a` directory and CMake
 * statically links it into our own JNI `libneedle.so`.
 *
 * Every download is verified against the SHA256 pinned in `engine.lock.json`
 * (HF `x-linked-etag` == SHA256 of the LFS object; independently re-verified by
 * hashing the downloaded bytes). A mismatch is never accepted.
 *
 * Transport policy (review S1): `https:` is the only scheme allowed in normal
 * runs. Plain `http:` is reachable only in explicit test mode — NODE_ENV=test
 * or the `--allow-http` flag — and only for loopback hosts, so the jest
 * fixtures can pin a local server without opening a cleartext/loopback-SSRF
 * hole at configure time. Redirects never follow an https request down to
 * http (see isAllowedRedirect); the bytes themselves are authenticated by the
 * pinned sha256, not by the redirect host (HF /resolve/ legitimately 302s to
 * a different CDN origin, so same-origin-only redirects would break fetches).
 *
 * Usage:
 *   node fetch-engine.js [options]
 *     --lock <path>   manifest path   (default: <this dir>/engine.lock.json)
 *     --dest <dir>    output root     (default: <module>/android/engine)
 *     --model <name>  only needle3 | needle2
 *     --abi <abi>     only arm64-v8a | armeabi-v7a | riscv64
 *     --force         re-download even when the cache already verifies
 *     --offline       verify the cache only; never touch the network
 *     --allow-http    permit plain http loopback urls (testing only)
 *     --quiet         only print errors
 *
 * Exit codes: 0 ok · 1 download/verification failure · 2 usage error.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const SCRIPT_DIR = __dirname;
const MODULE_DIR = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCK = path.join(SCRIPT_DIR, 'engine.lock.json');
const DEFAULT_DEST = path.join(MODULE_DIR, 'android', 'engine');

const MODELS = ['needle3', 'needle2'];
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'riscv64'];
const UPSTREAM_ABI = {
  'arm64-v8a': 'android-arm64',
  'armeabi-v7a': 'android-armv7',
  riscv64: 'android-riscv64',
};

const SHA256_RE = /^[0-9a-f]{64}$/;

function fail(message) {
  const err = new Error(message);
  err.exitCode = 1;
  return err;
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

function isLoopback(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

/**
 * Transport gate: https is always allowed; plain http only when explicitly
 * testing (NODE_ENV=test or the --allow-http flag) AND only for loopback.
 * Normal/configure-time runs reject http outright — no cleartext fetches and
 * no loopback SSRF via a hostile manifest or redirect.
 */
function isAllowedUrl(rawUrl, allowHttp) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') {
    return Boolean(allowHttp) && isLoopback(url.hostname);
  }
  return false;
}

/**
 * Redirect gate (review S1): an https request must NEVER be followed down to
 * http — including to loopback — so a compromised/redirecting host cannot
 * strip transport security. Same-origin-only is deliberately not required:
 * HF /resolve/ answers 302 to a different CDN origin and the pinned sha256 in
 * the manifest authenticates the bytes regardless of which https host serves
 * them. http sources (test mode only) may redirect within the same policy.
 */
function isAllowedRedirect(fromRawUrl, toRawUrl, allowHttp) {
  let from;
  let to;
  try {
    from = new URL(fromRawUrl);
    to = new URL(toRawUrl);
  } catch {
    return false;
  }
  if (from.protocol === 'https:' && to.protocol !== 'https:') {
    return false; // no protocol downgrade, ever
  }
  return isAllowedUrl(toRawUrl, allowHttp);
}

/**
 * Parse + validate the manifest. Every model x ABI combination must be pinned
 * exactly once, otherwise a build could silently skip an archive.
 */
function loadManifest(lockPath, allowHttp) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (e) {
    throw fail(`fetch-engine: cannot read manifest ${lockPath}: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw fail(`fetch-engine: manifest ${lockPath} is not valid JSON: ${e.message}`);
  }
  if (!parsed || !Array.isArray(parsed.engines)) {
    throw fail(`fetch-engine: manifest ${lockPath} has no "engines" array`);
  }

  const seen = new Set();
  for (const entry of parsed.engines) {
    const key = `${entry.model}/${entry.abi}`;
    if (!MODELS.includes(entry.model)) {
      throw fail(`fetch-engine: manifest entry ${key} has unknown model`);
    }
    if (!ABIS.includes(entry.abi)) {
      throw fail(`fetch-engine: manifest entry ${key} has unknown abi`);
    }
    if (seen.has(key)) {
      throw fail(`fetch-engine: manifest pins ${key} more than once`);
    }
    seen.add(key);
    if (entry.upstreamAbi !== UPSTREAM_ABI[entry.abi]) {
      throw fail(
        `fetch-engine: manifest entry ${key} upstreamAbi "${entry.upstreamAbi}" ` +
          `!= expected "${UPSTREAM_ABI[entry.abi]}"`
      );
    }
    if (typeof entry.url !== 'string') {
      throw fail(`fetch-engine: manifest entry ${key} has invalid url "${entry.url}"`);
    }
    if (!isAllowedUrl(entry.url, allowHttp)) {
      const hint =
        entry.url.startsWith('http://')
          ? 'plain http is only allowed when NODE_ENV=test or --allow-http is passed'
          : 'only https urls are fetched';
      throw fail(`fetch-engine: manifest entry ${key} has disallowed url "${entry.url}" — ${hint}`);
    }
    if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
      throw fail(`fetch-engine: manifest entry ${key} has invalid sha256 "${entry.sha256}"`);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
      throw fail(`fetch-engine: manifest entry ${key} has invalid bytes "${entry.bytes}"`);
    }
  }

  const missing = [];
  for (const model of MODELS) {
    for (const abi of ABIS) {
      if (!seen.has(`${model}/${abi}`)) missing.push(`${model}/${abi}`);
    }
  }
  if (missing.length) {
    throw fail(
      `fetch-engine: manifest ${lockPath} is incomplete — missing pins: ${missing.join(', ')}`
    );
  }

  const byKey = new Map(parsed.engines.map((e) => [`${e.model}/${e.abi}`, e]));
  return { manifest: parsed, byKey };
}

function selectEntries(byKey, model, abi) {
  const usageError = (message) => {
    const err = new Error(message);
    err.exitCode = 2;
    return err;
  };
  const models = model ? [model] : MODELS;
  const abis = abi ? [abi] : ABIS;
  if (model && !MODELS.includes(model)) {
    throw usageError(`fetch-engine: unknown --model "${model}" (expected ${MODELS.join(' | ')})`);
  }
  if (abi && !ABIS.includes(abi)) {
    throw usageError(`fetch-engine: unknown --abi "${abi}" (expected ${ABIS.join(' | ')})`);
  }
  const out = [];
  for (const m of models) {
    for (const a of abis) {
      const entry = byKey.get(`${m}/${a}`);
      if (!entry) throw fail(`fetch-engine: no manifest entry for ${m}/${a}`);
      out.push(entry);
    }
  }
  return out;
}

function enginePath(destRoot, entry) {
  return path.join(destRoot, entry.model, entry.abi, 'libneedle.a');
}

/** Follow up to 10 redirects, stream the body to `tmpPath`, hash as we go. */
function downloadTo(url, tmpPath, allowHttp, redirectsLeft = 10) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(fail(`fetch-engine: bad url ${url}: ${e.message}`));
      return;
    }
    if (!isAllowedUrl(parsed.toString(), allowHttp)) {
      reject(fail(`fetch-engine: refusing to fetch disallowed url ${url}`));
      return;
    }
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.get(
      parsed,
      {
        headers: { 'user-agent': 'vela-needle-fetch-engine/1.0' },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(fail(`fetch-engine: too many redirects fetching ${url}`));
            return;
          }
          let next;
          try {
            next = new URL(res.headers.location, parsed).toString();
          } catch (e) {
            reject(fail(`fetch-engine: bad redirect target from ${url}: ${res.headers.location}`));
            return;
          }
          // Never follow https down to http (not even loopback) — review S1.
          if (!isAllowedRedirect(parsed.toString(), next, allowHttp)) {
            reject(
              fail(
                `fetch-engine: refusing redirect from ${parsed.protocol}//${parsed.host} ` +
                  `to ${next} (no https→http downgrade; plain http requires NODE_ENV=test or --allow-http)`
              )
            );
            return;
          }
          resolve(downloadTo(next, tmpPath, allowHttp, redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(fail(`fetch-engine: HTTP ${status} fetching ${url}`));
          return;
        }
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        const out = fs.createWriteStream(tmpPath);
        res.on('data', (chunk) => {
          hash.update(chunk);
          bytes += chunk.length;
        });
        res.on('error', (e) => {
          out.destroy();
          reject(fail(`fetch-engine: network error fetching ${url}: ${e.message}`));
        });
        out.on('error', (e) => {
          reject(fail(`fetch-engine: cannot write ${tmpPath}: ${e.message}`));
        });
        out.on('finish', () => {
          out.close(() => resolve({ sha256: hash.digest('hex'), bytes }));
        });
        res.pipe(out);
      }
    );
    req.setTimeout(120000, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (e) => {
      reject(fail(`fetch-engine: request failed for ${url}: ${e.message}`));
    });
  });
}

async function fetchEntry(entry, destRoot, opts) {
  const dest = enginePath(destRoot, entry);
  const label = `${entry.model}/${entry.abi}`;

  if (!opts.force && fs.existsSync(dest)) {
    let cached;
    try {
      cached = sha256File(dest);
    } catch {
      cached = null;
    }
    if (cached && cached.sha256 === entry.sha256 && cached.bytes === entry.bytes) {
      opts.log(`OK   ${label} ${entry.bytes} sha256=${entry.sha256} (cached)`);
      return { entry, dest, status: 'cached' };
    }
    const got = cached ? `sha256=${cached.sha256} bytes=${cached.bytes}` : 'unreadable';
    if (opts.offline) {
      throw fail(
        `fetch-engine: ${label} cached file failed verification (${got} expected ` +
          `sha256=${entry.sha256} bytes=${entry.bytes}) and --offline forbids ` +
          `downloading — refusing to use an unverified archive`
      );
    }
    opts.log(
      `WARN ${label} cached file failed verification (${got} expected ` +
        `sha256=${entry.sha256} bytes=${entry.bytes}) — re-downloading`
    );
  }

  if (opts.offline) {
    throw fail(
      `fetch-engine: ${label} needs a download (missing, stale, or --force) ` +
        `but --offline forbids it — run without --offline to fetch and verify`
    );
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let result;
  try {
    result = await downloadTo(entry.url, tmp, opts.allowHttp);
  } catch (e) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw e;
  }

  if (result.sha256 !== entry.sha256 || result.bytes !== entry.bytes) {
    fs.unlinkSync(tmp);
    throw fail(
      `fetch-engine: checksum mismatch for ${label} — expected sha256=${entry.sha256} ` +
        `bytes=${entry.bytes}, got sha256=${result.sha256} bytes=${result.bytes} ` +
        `(${entry.url}). Refusing to install; the download was deleted.`
    );
  }

  fs.renameSync(tmp, dest);
  opts.log(`OK   ${label} ${result.bytes} sha256=${result.sha256} (downloaded)`);
  return { entry, dest, status: 'downloaded' };
}

async function fetchEntries(entries, destRoot, opts = {}) {
  const options = {
    force: Boolean(opts.force),
    quiet: Boolean(opts.quiet),
    offline: Boolean(opts.offline),
    allowHttp: Boolean(opts.allowHttp),
    log: opts.log || (() => {}),
  };
  if (!options.quiet && !opts.log) {
    options.log = (line) => console.log(`fetch-engine: ${line}`);
  }
  const results = [];
  for (const entry of entries) {
    results.push(await fetchEntry(entry, destRoot, options));
  }
  return results;
}

function parseArgv(argv) {
  const opts = {
    lock: DEFAULT_LOCK,
    dest: DEFAULT_DEST,
    model: null,
    abi: null,
    force: false,
    offline: false,
    allowHttp: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const needValue = () => {
      i += 1;
      if (i >= argv.length) {
        const err = new Error(`fetch-engine: ${arg} requires a value`);
        err.exitCode = 2;
        throw err;
      }
      return argv[i];
    };
    switch (arg) {
      case '--lock':
        opts.lock = path.resolve(needValue());
        break;
      case '--dest':
        opts.dest = path.resolve(needValue());
        break;
      case '--model':
        opts.model = needValue();
        break;
      case '--abi':
        opts.abi = needValue();
        break;
      case '--force':
        opts.force = true;
        break;
      case '--offline':
        opts.offline = true;
        break;
      case '--allow-http':
        opts.allowHttp = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--help':
      case '-h': {
        const err = new Error('fetch-engine: see the header comment in fetch-engine.js');
        err.exitCode = 0;
        throw err;
      }
      default: {
        const err = new Error(`fetch-engine: unknown argument "${arg}"`);
        err.exitCode = 2;
        throw err;
      }
    }
  }
  // Transport gate: plain http loopback only when explicitly testing
  // (NODE_ENV=test under jest, or the explicit --allow-http flag).
  opts.allowHttp = opts.allowHttp || process.env.NODE_ENV === 'test';
  return opts;
}

async function main(argv) {
  const opts = parseArgv(argv);
  const { byKey } = loadManifest(opts.lock, opts.allowHttp);
  const entries = selectEntries(byKey, opts.model, opts.abi);
  await fetchEntries(entries, opts.dest, opts);
  if (!opts.quiet) {
    console.log(
      `fetch-engine: ${entries.length} engine archive(s) verified under ${opts.dest}`
    );
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      const code = typeof err.exitCode === 'number' ? err.exitCode : 1;
      console.error(err.message);
      process.exit(code);
    }
  );
}

module.exports = {
  MODELS,
  ABIS,
  UPSTREAM_ABI,
  DEFAULT_LOCK,
  DEFAULT_DEST,
  isAllowedUrl,
  isAllowedRedirect,
  loadManifest,
  selectEntries,
  enginePath,
  sha256File,
  fetchEntries,
  parseArgv,
  main,
};
