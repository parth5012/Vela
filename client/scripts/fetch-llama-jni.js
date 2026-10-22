#!/usr/bin/env node
/**
 * Windows-safe fetch for llama.rn's prebuilt Android JNI libraries.
 *
 * Why this exists: `llama.rn@0.12.9` ships no `jniLibs` in the npm tarball — its
 * own `postinstall` downloads `llama-rn-android-jni-libs.tar.gz` from the
 * matching GitHub release. That script shells out to whatever `tar` is on PATH,
 * and on Windows that is usually MSYS/GNU tar, which reads an absolute
 * `C:\...` archive path as a remote host and dies with
 * `tar (child): Cannot connect to C: resolve failed`. The failure leaves
 * `android/src/main/jniLibs` empty, Gradle packages RNLlama's Java classes but
 * no `librnllama.so`, and every GGUF model silently degrades to mock mode.
 *
 * This script downloads the same archive, verifies the SHA-256 published in
 * `install/native-artifacts.json`, and extracts it with Windows' bundled
 * bsdtar (`%SystemRoot%\System32\tar.exe`), which handles Windows paths.
 *
 * It is safe to run repeatedly: a complete install is detected and skipped.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ANDROID_ARTIFACT_NAME = 'android-jni-libs';
const REQUIRED_LIB = path.join('arm64-v8a', 'librnllama.so');
/** A real `librnllama.so` is ~9.8 MB; anything tiny means a truncated extract. */
const MIN_LIB_BYTES = 1_000_000;

/** Absolute path to the installed llama.rn package. */
function llamaPackageDir() {
  return path.join(__dirname, '..', 'node_modules', 'llama.rn');
}

/** Picks the Android artifact descriptor out of `install/native-artifacts.json`. */
function findAndroidArtifact(manifest) {
  const artifact = (manifest?.artifacts || []).find((a) => a.name === ANDROID_ARTIFACT_NAME);
  if (!artifact) {
    throw new Error(`llama.rn manifest has no "${ANDROID_ARTIFACT_NAME}" artifact`);
  }
  return artifact;
}

/** Builds the release asset URL for a package version. */
function artifactUrl(version, artifact) {
  return `https://github.com/mybigday/llama.rn/releases/download/v${version}/${artifact.assetName}`;
}

/**
 * True when the package already carries a real arm64 native library.
 * The size floor catches a truncated/partial extract.
 */
function isJniLibsInstalled(packageDir, artifact) {
  const lib = path.join(packageDir, artifact.relativePath, REQUIRED_LIB);
  try {
    return fs.statSync(lib).size >= MIN_LIB_BYTES;
  } catch {
    return false;
  }
}

/** SHA-256 of a file, lowercase hex. */
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Downloads `url` to `dest`, following GitHub's redirect to the asset host. */
function download(url, dest, redirects = 0) {
  // eslint-disable-next-line global-require
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'vela-fetch-llama-jni' } }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 5) {
            reject(new Error(`too many redirects for ${url}`));
            return;
          }
          resolve(download(res.headers.location, dest, redirects + 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`download failed (HTTP ${status}) for ${url}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Extracts `archive` into `destDir` using a tar that understands Windows paths. */
function extract(archive, destDir) {
  const tarBin =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  execFileSync(tarBin, ['-xzf', archive, '-C', destDir], { stdio: 'inherit' });
}

/**
 * Ensures llama.rn's Android JNI libs are present.
 * Returns true when it had to download, false when the install was already good.
 */
async function ensureLlamaJniLibs({ packageDir = llamaPackageDir(), log = console.log } = {}) {
  const manifestPath = path.join(packageDir, 'install', 'native-artifacts.json');
  if (!fs.existsSync(manifestPath)) {
    log('llama.rn: package not installed, skipping JNI lib check');
    return false;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifact = findAndroidArtifact(manifest);
  if (isJniLibsInstalled(packageDir, artifact)) {
    return false;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const url = artifactUrl(pkg.version, artifact);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-jni-'));
  const archive = path.join(tmpDir, artifact.assetName);

  log(`llama.rn: downloading ${artifact.assetName} (${pkg.version})`);
  await download(url, archive);

  const actual = sha256File(archive);
  if (actual !== artifact.sha256) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      `llama.rn: SHA-256 mismatch for ${artifact.assetName}\n  expected ${artifact.sha256}\n  actual   ${actual}`
    );
  }

  fs.mkdirSync(packageDir, { recursive: true });
  extract(archive, packageDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (!isJniLibsInstalled(packageDir, artifact)) {
    throw new Error('llama.rn: extraction finished but librnllama.so is still missing');
  }
  // Stamp the verified archive hash the way llama.rn's own extractor does.
  fs.writeFileSync(path.join(packageDir, artifact.markerPath), `${artifact.sha256}\n`);
  log('llama.rn: Android JNI libs installed');
  return true;
}

module.exports = {
  ANDROID_ARTIFACT_NAME,
  REQUIRED_LIB,
  findAndroidArtifact,
  artifactUrl,
  isJniLibsInstalled,
  sha256File,
  ensureLlamaJniLibs,
};

if (require.main === module) {
  ensureLlamaJniLibs().catch((err) => {
    console.error(`llama.rn: ${err.message}`);
    process.exit(1);
  });
}
