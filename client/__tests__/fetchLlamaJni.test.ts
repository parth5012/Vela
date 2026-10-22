/**
 * Guards the Windows-safe llama.rn JNI download path.
 *
 * `llama.rn`'s own postinstall uses whatever `tar` is on PATH; on Windows that
 * is MSYS tar, which fails on `C:\...` archive paths and leaves `jniLibs`
 * empty. Gradle then packages RNLlama's Java classes without `librnllama.so`,
 * and every GGUF model silently falls back to mock mode.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findAndroidArtifact,
  artifactUrl,
  isJniLibsInstalled,
  sha256File,
} = require('../scripts/fetch-llama-jni');

const MANIFEST = {
  artifacts: [
    {
      name: 'android-jni-libs',
      assetName: 'llama-rn-android-jni-libs.tar.gz',
      relativePath: 'android/src/main/jniLibs',
      markerPath: 'android/src/main/jniLibs/.llama-rn.sha256',
      sha256: 'cda945a7c0ed075a0b028c1c3c6f5b668532eb18b069ecc4793ed7ca6cdb65ac',
    },
    { name: 'ios-xcframework', assetName: 'llama-rn-ios-xcframework.tar.gz' },
  ],
};

function makePackageDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llama-pkg-'));
}

describe('fetch-llama-jni', () => {
  let packageDir: string;

  beforeEach(() => {
    packageDir = makePackageDir();
  });

  afterEach(() => {
    fs.rmSync(packageDir, { recursive: true, force: true });
  });

  it('finds the Android artifact in the manifest', () => {
    expect(findAndroidArtifact(MANIFEST).relativePath).toBe('android/src/main/jniLibs');
  });

  it('throws when the manifest has no Android artifact', () => {
    expect(() => findAndroidArtifact({ artifacts: [] })).toThrow(/android-jni-libs/);
  });

  it('builds the release asset URL from the package version', () => {
    expect(artifactUrl('0.12.9', findAndroidArtifact(MANIFEST))).toBe(
      'https://github.com/mybigday/llama.rn/releases/download/v0.12.9/llama-rn-android-jni-libs.tar.gz'
    );
  });

  it('reports the libs as missing until a full-size arm64 library exists', () => {
    const artifact = findAndroidArtifact(MANIFEST);
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(false);

    const libsDir = path.join(packageDir, artifact.relativePath);
    fs.mkdirSync(path.join(libsDir, 'arm64-v8a'), { recursive: true });
    const lib = path.join(libsDir, 'arm64-v8a', 'librnllama.so');
    // A truncated extract must not count as installed.
    fs.writeFileSync(lib, 'lib');
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(false);

    fs.writeFileSync(lib, Buffer.alloc(1_100_000));
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(true);
  });

  it('hashes files with SHA-256', () => {
    const file = path.join(packageDir, 'blob');
    fs.writeFileSync(file, 'vela');
    expect(sha256File(file)).toBe(
      '49b8ebd7fa9eb7eca44fcc7301b34c4ced40d2fe6647f273f2bb0e1fb4ad23c3'
    );
  });
});
