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
  ensureLlamaJniLibs,
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

  it('reports the libs as missing until a full-size arm64 library is stamped', () => {
    const artifact = findAndroidArtifact(MANIFEST);
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(false);

    const libsDir = path.join(packageDir, artifact.relativePath);
    fs.mkdirSync(path.join(libsDir, 'arm64-v8a'), { recursive: true });
    const lib = path.join(libsDir, 'arm64-v8a', 'librnllama.so');
    // A truncated extract must not count as installed.
    fs.writeFileSync(lib, 'lib');
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(false);

    // Size alone is not proof: a tampered or stale-from-another-version .so
    // can be full size. Only the verified-archive marker proves the extract.
    fs.writeFileSync(lib, Buffer.alloc(1_100_000));
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(false);

    fs.mkdirSync(path.dirname(path.join(packageDir, artifact.markerPath)), { recursive: true });
    fs.writeFileSync(path.join(packageDir, artifact.markerPath), 'not-the-archive-hash\n');
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(false);

    fs.writeFileSync(path.join(packageDir, artifact.markerPath), `${artifact.sha256}\n`);
    expect(isJniLibsInstalled(packageDir, artifact)).toBe(true);
  });

  it('hashes files with SHA-256', () => {
    const file = path.join(packageDir, 'blob');
    fs.writeFileSync(file, 'vela');
    expect(sha256File(file)).toBe(
      '49b8ebd7fa9eb7eca44fcc7301b34c4ced40d2fe6647f273f2bb0e1fb4ad23c3'
    );
  });

  describe('ensureLlamaJniLibs', () => {
    const archiveBytes = Buffer.from('fake llama-rn archive');
    let archivePath: string;
    let archiveSha: string;

    function writePackage(sha: string) {
      fs.mkdirSync(path.join(packageDir, 'install'), { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ version: '0.12.9' })
      );
      fs.writeFileSync(
        path.join(packageDir, 'install', 'native-artifacts.json'),
        JSON.stringify({
          artifacts: [
            {
              name: 'android-jni-libs',
              assetName: 'llama-rn-android-jni-libs.tar.gz',
              relativePath: 'android/src/main/jniLibs',
              markerPath: 'android/src/main/jniLibs/.llama-rn.sha256',
              sha256: sha,
            },
          ],
        })
      );
    }

    /** Stands in for `tar -xzf`: materializes the library the archive carries. */
    const fakeExtract = (_archive: string, destDir: string) => {
      const libsDir = path.join(destDir, 'android', 'src', 'main', 'jniLibs', 'arm64-v8a');
      fs.mkdirSync(libsDir, { recursive: true });
      fs.writeFileSync(path.join(libsDir, 'librnllama.so'), Buffer.alloc(1_100_000));
    };

    beforeEach(() => {
      archivePath = path.join(packageDir, 'archive.tar.gz');
      fs.writeFileSync(archivePath, archiveBytes);
      archiveSha = sha256File(archivePath);
      fs.rmSync(archivePath, { force: true });
    });

    it('downloads, verifies, extracts, and stamps the marker', async () => {
      writePackage(archiveSha);
      const downloadImpl = jest.fn(async (_url: string, dest: string) => {
        fs.writeFileSync(dest, archiveBytes);
      });
      const extractImpl = jest.fn(fakeExtract);

      await expect(
        ensureLlamaJniLibs({ packageDir, log: () => {}, downloadImpl, extractImpl })
      ).resolves.toBe(true);

      expect(downloadImpl).toHaveBeenCalledTimes(1);
      expect(extractImpl).toHaveBeenCalledTimes(1);
      expect(
        fs.readFileSync(path.join(packageDir, 'android/src/main/jniLibs/.llama-rn.sha256'), 'utf8')
      ).toBe(`${archiveSha}\n`);
      expect(isJniLibsInstalled(packageDir, findAndroidArtifact(JSON.parse(
        fs.readFileSync(path.join(packageDir, 'install', 'native-artifacts.json'), 'utf8')
      )))).toBe(true);
    });

    it('skips a verified install instead of re-downloading', async () => {
      writePackage(archiveSha);
      fakeExtract(archivePath, packageDir);
      fs.mkdirSync(path.join(packageDir, 'android/src/main/jniLibs'), { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, 'android/src/main/jniLibs/.llama-rn.sha256'),
        `${archiveSha}\n`
      );
      const downloadImpl = jest.fn();

      await expect(
        ensureLlamaJniLibs({ packageDir, log: () => {}, downloadImpl })
      ).resolves.toBe(false);
      expect(downloadImpl).not.toHaveBeenCalled();
    });

    it('rejects a tampered archive and never stamps the marker', async () => {
      // Publish a hash that does not match the bytes the "network" returns.
      writePackage('0'.repeat(64));
      const downloadImpl = jest.fn(async (_url: string, dest: string) => {
        fs.writeFileSync(dest, archiveBytes);
      });
      const extractImpl = jest.fn(fakeExtract);

      await expect(
        ensureLlamaJniLibs({ packageDir, log: () => {}, downloadImpl, extractImpl })
      ).rejects.toThrow(/SHA-256 mismatch/);

      expect(extractImpl).not.toHaveBeenCalled();
      expect(
        fs.existsSync(path.join(packageDir, 'android/src/main/jniLibs/.llama-rn.sha256'))
      ).toBe(false);
    });
  });
});
