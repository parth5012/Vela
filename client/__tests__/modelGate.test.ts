import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  evaluateDeviceCapabilities,
  fetchRemoteModelConfig,
  checkNetworkDownloadAllowed,
  verifyArtifactIntegrity,
  recoverCorruptArtifact,
  detectCpuArchitecture,
  DEFAULT_FALLBACK_MODEL_CONFIG,
  ModelDownloadGate,
  ResumableModelDownloader,
  type DeviceCapabilityOptions,
  type ModelArtifactConfig,
} from '../utils/modelGate';

describe('WF-05: Model Download + Device Capability Gate', () => {
  const GB = 1024 * 1024 * 1024;

  describe('Device Capability Checks (RAM, Disk, Architecture)', () => {
    it('returns OK for a device meeting 8 GB RAM, >= 3 GB disk, and arm64-v8a', async () => {
      const options: DeviceCapabilityOptions = {
        ramBytes: 8 * GB,
        freeDiskBytes: 10 * GB,
        architecture: 'arm64-v8a',
      };

      const result = await evaluateDeviceCapabilities(options);

      expect(result.status).toBe('OK');
      expect(result.canRunOnDevice).toBe(true);
      expect(result.contextWindowLimit).toBe(4096);
      expect(result.reasons).toHaveLength(0);
    });

    it('returns DEGRADED for a device meeting 6 GB floor but < 8 GB RAM with 1024 context window', async () => {
      const options: DeviceCapabilityOptions = {
        ramBytes: 6 * GB,
        freeDiskBytes: 5 * GB,
        architecture: 'arm64-v8a',
      };

      const result = await evaluateDeviceCapabilities(options);

      expect(result.status).toBe('DEGRADED');
      expect(result.canRunOnDevice).toBe(true);
      expect(result.contextWindowLimit).toBe(1024);
      expect(result.reasons.some((r) => r.includes('pruned 1024-token context'))).toBe(true);
    });

    it('returns UNSUPPORTED for devices with < 6 GB RAM floor', async () => {
      const options: DeviceCapabilityOptions = {
        ramBytes: 4 * GB,
        freeDiskBytes: 10 * GB,
        architecture: 'arm64-v8a',
      };

      const result = await evaluateDeviceCapabilities(options);

      expect(result.status).toBe('UNSUPPORTED');
      expect(result.canRunOnDevice).toBe(false);
      expect(result.contextWindowLimit).toBe(0);
      expect(result.reasons.some((r) => r.includes('minimum 6 GB floor'))).toBe(true);
    });

    it('returns UNSUPPORTED when free disk space is less than 3 GB', async () => {
      const options: DeviceCapabilityOptions = {
        ramBytes: 8 * GB,
        freeDiskBytes: 2.2 * GB,
        architecture: 'arm64-v8a',
      };

      const result = await evaluateDeviceCapabilities(options);

      expect(result.status).toBe('UNSUPPORTED');
      expect(result.canRunOnDevice).toBe(false);
      expect(result.reasons.some((r) => r.includes('minimum 3 GB'))).toBe(true);
    });

    it('returns UNSUPPORTED for non-arm64 architectures (e.g. armeabi-v7a or 32-bit x86)', async () => {
      const options: DeviceCapabilityOptions = {
        ramBytes: 8 * GB,
        freeDiskBytes: 10 * GB,
        architecture: 'armeabi-v7a',
      };

      const result = await evaluateDeviceCapabilities(options);

      expect(result.status).toBe('UNSUPPORTED');
      expect(result.canRunOnDevice).toBe(false);
      expect(result.reasons.some((r) => r.includes('arm64-v8a'))).toBe(true);
    });

    it('allows x86_64 when allowEmulator flag is explicitly passed for dev/testing', async () => {
      const options: DeviceCapabilityOptions = {
        ramBytes: 8 * GB,
        freeDiskBytes: 10 * GB,
        architecture: 'x86_64',
        allowEmulator: true,
      };

      const result = await evaluateDeviceCapabilities(options);

      expect(result.status).toBe('OK');
      expect(result.canRunOnDevice).toBe(true);
    });

    it('returns UNSUPPORTED when device RAM cannot be determined or is 0 bytes', async () => {
      const result = await evaluateDeviceCapabilities({
        ramBytes: 0,
        freeDiskBytes: 10 * GB,
        architecture: 'arm64-v8a',
      });

      expect(result.status).toBe('UNSUPPORTED');
      expect(result.canRunOnDevice).toBe(false);
      expect(result.reasons.some((r) => r.includes('Unable to determine device RAM'))).toBe(true);
    });

    it('returns UNSUPPORTED when free disk storage is 0 or cannot be read', async () => {
      const result = await evaluateDeviceCapabilities({
        ramBytes: 8 * GB,
        freeDiskBytes: 0,
        architecture: 'arm64-v8a',
      });

      expect(result.status).toBe('UNSUPPORTED');
      expect(result.canRunOnDevice).toBe(false);
      expect(result.reasons.some((r) => r.includes('Unable to determine free storage'))).toBe(true);
    });

    it('fails closed with an unsupported sentinel when CPU architecture detection is unavailable', () => {
      const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
      const originalDeviceArch = Object.getOwnPropertyDescriptor(
        Device,
        'supportedCpuArchitectures'
      );
      const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      Object.defineProperty(Device, 'supportedCpuArchitectures', {
        value: null,
        configurable: true,
      });
      Object.defineProperty(process, 'arch', { value: undefined, configurable: true });

      try {
        // Expo documents supportedCpuArchitectures as null when detection fails;
        // the gate must not assume arm64 for an unverified ABI.
        expect(detectCpuArchitecture()).toBe('unknown');
      } finally {
        if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
        if (originalDeviceArch) {
          Object.defineProperty(Device, 'supportedCpuArchitectures', originalDeviceArch);
        }
        if (originalArch) Object.defineProperty(process, 'arch', originalArch);
      }
    });
  });

  describe('Dynamic Remote Model Config (Never Hardcoded)', () => {
    it('fetches model artifact config from remote endpoint', async () => {
      const mockConfig: ModelArtifactConfig = {
        modelId: 'minicpm5-2b-int4',
        name: 'MiniCPM5-2B (LiteRT)',
        downloadUrl: 'https://cdn.example.com/models/MiniCPM5-2B_int4.litertlm',
        filename: 'MiniCPM5-2B_int4.litertlm',
        format: 'litertlm',
        sizeBytes: 1553670064,
        sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        minRamGb: 6,
        minStorageGb: 3,
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockConfig,
      } as any);

      const config = await fetchRemoteModelConfig('https://api.vela.app/config/model', mockFetch);

      expect(config.modelId).toBe('minicpm5-2b-int4');
      expect(config.downloadUrl).toBe('https://cdn.example.com/models/MiniCPM5-2B_int4.litertlm');
      expect(config.sha256).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
      expect(config.minRamGb).toBe(6);
    });

    it('falls back to default remote config endpoint when URL is not provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          modelId: 'minicpm5-2b-int4',
          name: 'MiniCPM5-2B (LiteRT)',
          downloadUrl: 'https://huggingface.co/litert-community/MiniCPM5-2B/resolve/main/MiniCPM5-2B_int4.litertlm',
          filename: 'MiniCPM5-2B_int4.litertlm',
          format: 'litertlm',
          sizeBytes: 1553670064,
          sha256: '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45',
          minRamGb: 6,
          minStorageGb: 3,
        }),
      } as any);

      const config = await fetchRemoteModelConfig(undefined, mockFetch);
      expect(config.modelId).toBe('minicpm5-2b-int4');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('rejects malformed remote payloads (invalid sha256 or non-https URL) and uses fallback config', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          modelId: 'bad-model',
          downloadUrl: 'http://insecure.example.com/model.litertlm', // Non-https
          sha256: 'short_hash', // Not 64 hex characters
          sizeBytes: -10, // Invalid size
          format: 'invalid_format',
        }),
      } as any);

      const config = await fetchRemoteModelConfig('https://api.vela.app/config/bad', mockFetch);
      expect(config.modelId).toBe('minicpm5-2b-int4');
      expect(config.sha256).toBe('05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45');
    });

    it('pins fallback config to the verified MiniCPM5-2B int4 artifact digest and size', () => {
      expect(DEFAULT_FALLBACK_MODEL_CONFIG.sha256).toBe(
        '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45'
      );
      expect(DEFAULT_FALLBACK_MODEL_CONFIG.sizeBytes).toBe(1553670064);
    });

    it('rejects remote configs that weaken the documented 6 GB RAM / 3 GB storage floors', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          modelId: 'weak-floor-model',
          name: 'Weak Floor Model',
          downloadUrl: 'https://cdn.example.com/models/weak.litertlm',
          filename: 'weak.litertlm',
          format: 'litertlm',
          sizeBytes: 1000,
          sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          minRamGb: 1,
          minStorageGb: 1,
        }),
      } as any);

      const config = await fetchRemoteModelConfig('https://api.vela.app/config/weak', mockFetch);

      expect(config).toBe(DEFAULT_FALLBACK_MODEL_CONFIG);
      expect(config.minRamGb).toBe(6);
      expect(config.minStorageGb).toBe(3);
    });
  });

  describe('Network Policy: Wi-Fi Only Default with Cellular Toggle', () => {
    it('allows download when connected to Wi-Fi regardless of wifiOnly setting', () => {
      const allowed = checkNetworkDownloadAllowed({
        isWifi: true,
        wifiOnly: true,
        allowCellular: false,
      });

      expect(allowed.allowed).toBe(true);
    });

    it('blocks download on cellular when wifiOnly is true and allowCellular is false', () => {
      const result = checkNetworkDownloadAllowed({
        isWifi: false,
        wifiOnly: true,
        allowCellular: false,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Wi-Fi only');
    });

    it('allows cellular download when allowCellular toggle is enabled', () => {
      const result = checkNetworkDownloadAllowed({
        isWifi: false,
        wifiOnly: true,
        allowCellular: true,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('SHA-256 Integrity Verification & Corrupt Artifact Recovery', () => {
    it('verifies valid file checksum against expected SHA-256', async () => {
      const mockHasher = jest.fn().mockResolvedValue(
        '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45'
      );

      const isValid = await verifyArtifactIntegrity(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45',
        mockHasher
      );

      expect(isValid).toBe(true);
      expect(mockHasher).toHaveBeenCalledWith('/data/models/MiniCPM5-2B_int4.litertlm');
    });

    it('rejects file when SHA-256 does not match', async () => {
      const mockHasher = jest.fn().mockResolvedValue('corrupted_hash_value_here');

      const isValid = await verifyArtifactIntegrity(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45',
        mockHasher
      );

      expect(isValid).toBe(false);
    });

    it('fails closed when hashProvider rejects instead of throwing', async () => {
      const failingHasher = jest.fn().mockRejectedValue(new Error('hash backend unavailable'));

      const isValid = await verifyArtifactIntegrity(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        '05b78bb57dd5ded8a76907cc953cbc57d6261ee9fa66fbfca21ae677a897da45',
        failingHasher
      );

      expect(isValid).toBe(false);
      expect(failingHasher).toHaveBeenCalled();
    });

    it('fails closed without a hashProvider even when the file exists with a matching digest', async () => {
      const fs = require('fs');
      const crypto = require('crypto');
      const path = require('path');

      const fixturePath = path.join(__dirname, '..', '.tmp', 'integrity-no-provider.bin');
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, 'vela model gate integrity fixture');
      const realDigest = crypto
        .createHash('sha256')
        .update(fs.readFileSync(fixturePath))
        .digest('hex');

      try {
        // hashProvider omitted: must fail closed (no fs/Base64 fallbacks) so a
        // provider-less caller can never silently "verify" a multi-GB artifact.
        const isValid = await (verifyArtifactIntegrity as any)(fixturePath, realDigest);

        expect(isValid).toBe(false);
      } finally {
        fs.rmSync(fixturePath, { force: true });
      }
    });

    it('recovers from corrupt artifact by purging file and clearing resume markers', async () => {
      const mockDelete = jest.fn().mockResolvedValue(undefined);
      const mockRemoveItem = jest.fn().mockResolvedValue(undefined);

      const recovery = await recoverCorruptArtifact(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        'minicpm5-2b-int4',
        {
          deleteAsync: mockDelete,
          removeItem: mockRemoveItem,
        }
      );

      expect(recovery.recovered).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('/data/models/MiniCPM5-2B_int4.litertlm', { idempotent: true });
      expect(mockRemoveItem).toHaveBeenCalledWith('download_resume_minicpm5-2b-int4');
      expect(mockRemoveItem).toHaveBeenCalledWith('model_status_minicpm5-2b-int4');
    });

    it('returns recovered: false when file deletion fails', async () => {
      const mockDelete = jest.fn().mockRejectedValue(new Error('Permission denied'));
      const mockRemoveItem = jest.fn().mockResolvedValue(undefined);

      const recovery = await recoverCorruptArtifact(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        'minicpm5-2b-int4',
        {
          deleteAsync: mockDelete,
          removeItem: mockRemoveItem,
        }
      );

      expect(recovery.recovered).toBe(false);
    });

    it('returns recovered: false when storage key removal rejects', async () => {
      const mockDelete = jest.fn().mockResolvedValue(undefined);
      const mockRemoveItem = jest.fn().mockRejectedValue(new Error('AsyncStorage error'));

      const recovery = await recoverCorruptArtifact(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        'minicpm5-2b-int4',
        {
          deleteAsync: mockDelete,
          removeItem: mockRemoveItem,
        }
      );

      expect(recovery.recovered).toBe(false);
    });
  });

  describe('ModelDownloadGate Workflow Integration', () => {
    it('fails closed when device capabilities are UNSUPPORTED', async () => {
      const gate = new ModelDownloadGate({
        capabilityOptions: {
          ramBytes: 3 * GB,
          freeDiskBytes: 10 * GB,
          architecture: 'arm64-v8a',
        },
      });

      const outcome = await gate.prepareDownload();
      expect(outcome.ready).toBe(false);
      expect(outcome.capability.status).toBe('UNSUPPORTED');
      expect(outcome.error).toContain('minimum 6 GB floor');
    });

    it('proceeds through capability check and network check to ready state', async () => {
      const gate = new ModelDownloadGate({
        capabilityOptions: {
          ramBytes: 8 * GB,
          freeDiskBytes: 10 * GB,
          architecture: 'arm64-v8a',
        },
        networkOptions: {
          isWifi: true,
          wifiOnly: true,
          allowCellular: false,
        },
      });

      const outcome = await gate.prepareDownload();
      expect(outcome.ready).toBe(true);
      expect(outcome.capability.status).toBe('OK');
      expect(outcome.modelConfig.modelId).toBe('minicpm5-2b-int4');
    });

    it('blocks download when networkOptions.isWifi is omitted on wifiOnly policy', async () => {
      const gate = new ModelDownloadGate({
        capabilityOptions: {
          ramBytes: 8 * GB,
          freeDiskBytes: 10 * GB,
          architecture: 'arm64-v8a',
        },
        networkOptions: {
          // isWifi omitted -> defaults to false (not assumed Wi-Fi)
          wifiOnly: true,
          allowCellular: false,
        },
      });

      const outcome = await gate.prepareDownload();
      expect(outcome.ready).toBe(false);
      expect(outcome.error).toContain('Wi-Fi only policy');
    });

    it('enforces higher RAM and disk requirements when specified by remote model config', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          modelId: 'large-model-int4',
          name: 'Large Model',
          downloadUrl: 'https://example.com/large.litertlm',
          filename: 'large.litertlm',
          format: 'litertlm',
          sizeBytes: 4000000000,
          sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          minRamGb: 12,
          minStorageGb: 8,
        }),
      } as any);

      const gate = new ModelDownloadGate({
        capabilityOptions: {
          ramBytes: 8 * GB, // passes default 6 GB, but fails remote 12 GB
          freeDiskBytes: 10 * GB,
          architecture: 'arm64-v8a',
        },
        remoteConfigUrl: 'https://api.vela.app/config/model',
        fetchFn: mockFetch,
      });

      const outcome = await gate.prepareDownload();
      expect(outcome.ready).toBe(false);
      expect(outcome.capability.status).toBe('UNSUPPORTED');
      expect(outcome.error).toContain('requires minimum 12 GB floor');
    });

    it('cannot weaken documented floors through caller-provided capabilityOptions', async () => {
      const gate = new ModelDownloadGate({
        capabilityOptions: {
          ramBytes: 4 * GB, // below the documented 6 GB floor
          freeDiskBytes: 2 * GB, // below the documented 3 GB floor
          architecture: 'arm64-v8a',
          ramFloorBytes: 1 * GB, // attempted weakening of the floor
          minDiskFreeBytes: 1 * GB, // attempted weakening of the floor
        },
      });

      const outcome = await gate.prepareDownload();

      expect(outcome.ready).toBe(false);
      expect(outcome.capability.status).toBe('UNSUPPORTED');
      expect(outcome.error).toContain('minimum 6 GB floor');
    });

    it('still enforces higher caller-provided RAM floors', async () => {
      const gate = new ModelDownloadGate({
        capabilityOptions: {
          ramBytes: 8 * GB,
          freeDiskBytes: 10 * GB,
          architecture: 'arm64-v8a',
          ramFloorBytes: 10 * GB,
        },
      });

      const outcome = await gate.prepareDownload();

      expect(outcome.ready).toBe(false);
      expect(outcome.capability.status).toBe('UNSUPPORTED');
      expect(outcome.error).toContain('requires minimum 10 GB floor');
    });
  });

  describe('ResumableModelDownloader Execution Flow', () => {
    const mockModel: ModelArtifactConfig = {
      modelId: 'minicpm5-2b-int4',
      name: 'MiniCPM5-2B',
      downloadUrl: 'https://example.com/model.litertlm',
      filename: 'model.litertlm',
      format: 'litertlm',
      sizeBytes: 1000,
      sha256: 'dummy_hash',
      minRamGb: 6,
      minStorageGb: 3,
    };

    it('manages download lifecycle with progress events and cleans up resume key upon completion', async () => {
      const progressUpdates: any[] = [];
      const mockStorage: Record<string, string> = {};

      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
        pauseAsync: jest.fn().mockResolvedValue({ resumeData: 'resume_token_123' }),
        resumeAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
      };

      const factory = jest.fn().mockImplementation((url, fileUri, opts, callback) => {
        // simulate progress tick
        callback({ totalBytesWritten: 500, totalBytesExpectedToWrite: 1000 });
        return mockDownloadResumable;
      });

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        onProgress: (p) => progressUpdates.push(p),
        storage: {
          getItem: async (key) => mockStorage[key] ?? null,
          setItem: async (key, val) => {
            mockStorage[key] = val;
          },
          removeItem: async (key) => {
            delete mockStorage[key];
          },
        },
        createDownloadResumableFn: factory,
      });

      const destination = await downloader.start();

      expect(destination).toBe('/data/models/model.litertlm');
      expect(factory).toHaveBeenCalled();
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].progressPercent).toBe(50);
      expect(downloader.getProgress().progressPercent).toBe(50);
    });

    it('pauses download, saves resume token to storage, and resumes cleanly', async () => {
      const mockStorage: Record<string, string> = {};

      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise(() => {})), // stays in progress
        pauseAsync: jest.fn().mockResolvedValue({ resumeData: 'resume_token_xyz' }),
        resumeAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
      };

      const factory = jest.fn().mockReturnValue(mockDownloadResumable);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: async (key) => mockStorage[key] ?? null,
          setItem: async (key, val) => {
            mockStorage[key] = val;
          },
          removeItem: async (key) => {
            delete mockStorage[key];
          },
        },
        createDownloadResumableFn: factory,
      });

      // Start in background
      downloader.start();

      // Pause
      const resumeToken = await downloader.pause();
      expect(resumeToken).toBe('resume_token_xyz');
      expect(mockStorage['download_resume_minicpm5-2b-int4']).toBe('resume_token_xyz');

      // Resume
      const finalUri = await downloader.resume();
      expect(finalUri).toBe('/data/models/model.litertlm');
      expect(mockStorage['download_resume_minicpm5-2b-int4']).toBeUndefined();
    });

    it('returns null and preserves resume key when download is paused (downloadAsync returns undefined)', async () => {
      const mockStorage: Record<string, string> = {
        'download_resume_minicpm5-2b-int4': 'saved_token_456',
      };

      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockResolvedValue(undefined), // Expo returns undefined on pause
        pauseAsync: jest.fn().mockResolvedValue({ resumeData: 'saved_token_456' }),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };

      const factory = jest.fn().mockReturnValue(mockDownloadResumable);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: async (key) => mockStorage[key] ?? null,
          setItem: async (key, val) => {
            mockStorage[key] = val;
          },
          removeItem: async (key) => {
            delete mockStorage[key];
          },
        },
        createDownloadResumableFn: factory,
      });

      const result = await downloader.start();
      expect(result).toBeNull();
      // Resume token must NOT be purged
      expect(mockStorage['download_resume_minicpm5-2b-int4']).toBe('saved_token_456');
    });

    it('honors a pause requested while start() is still loading resume state', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise(() => {})),
        pauseAsync: jest.fn().mockResolvedValue({ resumeData: 'late_pause_token' }),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          // Slow storage read: no download instance exists for the first 50 ms
          getItem: jest
            .fn()
            .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 50))),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem: jest.fn().mockResolvedValue(undefined),
        },
        createDownloadResumableFn: factory,
      });

      const startPromise = downloader.start();
      const pausePromise = downloader.pause();

      const resumeToken = await pausePromise;

      expect(resumeToken).toBe('late_pause_token');
      expect(mockDownloadResumable.pauseAsync).toHaveBeenCalled();
      void startPromise;
    });

    it('honors a cancel requested while start() is still loading resume state', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise(() => {})),
        pauseAsync: jest.fn().mockResolvedValue({ resumeData: 'cancelled_token' }),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);
      const removeItem = jest.fn().mockResolvedValue(undefined);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest
            .fn()
            .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 50))),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem,
        },
        createDownloadResumableFn: factory,
      });

      const startPromise = downloader.start();
      await downloader.cancel();

      // New cancel-during-init semantics: the transfer is never started for an
      // abandoned request, so there is nothing to pause — but the resume token
      // is still cleared so no stale state survives the cancellation.
      expect(mockDownloadResumable.downloadAsync).not.toHaveBeenCalled();
      expect(mockDownloadResumable.pauseAsync).not.toHaveBeenCalled();
      expect(removeItem).toHaveBeenCalledWith('download_resume_minicpm5-2b-int4');
      void startPromise;
    });

    it('ignores a second start() while a download is already in flight', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise(() => {})),
        pauseAsync: jest.fn().mockResolvedValue(undefined),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest.fn().mockResolvedValue(null),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem: jest.fn().mockResolvedValue(undefined),
        },
        createDownloadResumableFn: factory,
      });

      const firstStart = downloader.start();
      const secondResult = await downloader.start();

      expect(secondResult).toBeNull();
      expect(factory).toHaveBeenCalledTimes(1);
      void firstStart;
    });

    it('ignores a resume() while a download is already in flight', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise(() => {})),
        pauseAsync: jest.fn().mockResolvedValue(undefined),
        resumeAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest.fn().mockResolvedValue(null),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem: jest.fn().mockResolvedValue(undefined),
        },
        createDownloadResumableFn: factory,
      });

      const startPromise = downloader.start();
      // Let initialization finish so downloadInstance exists and is in flight.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const resumeResult = await downloader.resume();

      expect(resumeResult).toBeNull();
      expect(mockDownloadResumable.resumeAsync).not.toHaveBeenCalled();
      void startPromise;
    });

    it('never starts the transfer when cancel() is issued during initialization', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
        pauseAsync: jest.fn().mockResolvedValue({ resumeData: 'unused' }),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);
      const removeItem = jest.fn().mockResolvedValue(undefined);
      const deleteFileFn = jest.fn().mockResolvedValue(undefined);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          // Slow storage read: cancel() lands while initialization is pending.
          getItem: jest
            .fn()
            .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 50))),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem,
        },
        createDownloadResumableFn: factory,
        deleteFileFn,
      });

      const startPromise = downloader.start();
      await downloader.cancel();

      // The transfer must never begin for a download cancelled during init,
      // and no cleanup of a (non-existent) partial artifact is needed.
      expect(mockDownloadResumable.downloadAsync).not.toHaveBeenCalled();
      expect(removeItem).toHaveBeenCalledWith('download_resume_minicpm5-2b-int4');
      expect(deleteFileFn).not.toHaveBeenCalled();
      await expect(startPromise).resolves.toBeNull();
    });

    it('unblocks start() after initialization fails', async () => {
      let failNextRead = true;
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
        pauseAsync: jest.fn().mockResolvedValue(undefined),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest.fn().mockImplementation(() => {
            if (failNextRead) {
              failNextRead = false;
              return Promise.reject(new Error('storage read failed'));
            }
            return Promise.resolve(null);
          }),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem: jest.fn().mockResolvedValue(undefined),
        },
        createDownloadResumableFn: factory,
      });

      await expect(downloader.start()).rejects.toThrow('storage read failed');

      const retryResult = await downloader.start();
      expect(retryResult).toBe('/data/models/model.litertlm');
    });

    it('cancel() deletes the partial artifact during an active download', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise(() => {})),
        pauseAsync: jest.fn().mockResolvedValue(undefined),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);
      const deleteFileFn = jest.fn().mockResolvedValue(undefined);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest.fn().mockResolvedValue(null),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem: jest.fn().mockResolvedValue(undefined),
        },
        createDownloadResumableFn: factory,
        deleteFileFn,
      });

      const startPromise = downloader.start();
      // Let initialization finish so the transfer is actually in flight.
      await new Promise((resolve) => setTimeout(resolve, 10));

      await downloader.cancel();

      expect(deleteFileFn).toHaveBeenCalledWith('/data/models/model.litertlm');
      void startPromise;
    });

    it('cancel() does not delete a completed artifact', async () => {
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
        pauseAsync: jest.fn().mockResolvedValue(undefined),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);
      const deleteFileFn = jest.fn().mockResolvedValue(undefined);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest.fn().mockResolvedValue(null),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem: jest.fn().mockResolvedValue(undefined),
        },
        createDownloadResumableFn: factory,
        deleteFileFn,
      });

      const destination = await downloader.start();
      expect(destination).toBe('/data/models/model.litertlm');

      await downloader.cancel();

      expect(deleteFileFn).not.toHaveBeenCalled();
    });

    it('treats a transport completion that lands during cancel() as cancelled', async () => {
      // cancel() calls pauseAsync() and waits on it before it finishes
      // cleanup. If the transport resolves downloadAsync() with a completed
      // URI during that pauseAsync() window, start() must still report the
      // download as cancelled (null), not success — checked via
      // cancelRequested, since isDownloading is also already false here.
      let resolveDownload!: (v: { uri: string; status: number }) => void;
      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockImplementation(() => new Promise((res) => {
          resolveDownload = res;
        })),
        pauseAsync: jest.fn().mockImplementation(async () => {
          // Transport "completes" concurrently with the pause request.
          resolveDownload({ uri: '/data/models/model.litertlm', status: 200 });
          return { resumeData: 'cancelled-token' };
        }),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);
      const removeItem = jest.fn().mockResolvedValue(undefined);

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage: {
          getItem: jest.fn().mockResolvedValue(null),
          setItem: jest.fn().mockResolvedValue(undefined),
          removeItem,
        },
        createDownloadResumableFn: factory,
      });

      const startPromise = downloader.start();
      // Let initialization finish so the transfer is in flight.
      await new Promise((resolve) => setTimeout(resolve, 10));

      await downloader.cancel();
      const startResult = await startPromise;

      expect(startResult).toBeNull();
    });

    it('does not let a cancelled cleanup delete a newly started download', async () => {
      // cancel() releases the isDownloading guard before its removeItem/delete
      // awaits. A start() issued in that window must not have its fresh
      // transfer deleted by the older cancel()'s cleanup.
      let rejectRead!: (e: Error) => void;
      let pauseSettled!: () => void;
      const pauseGate = new Promise<void>((resolve) => {
        pauseSettled = resolve;
      });

      const mockDownloadResumable = {
        downloadAsync: jest.fn().mockResolvedValue({ uri: '/data/models/model.litertlm', status: 200 }),
        pauseAsync: jest.fn().mockImplementation(() => pauseGate),
        resumeAsync: jest.fn().mockResolvedValue(undefined),
      };
      const factory = jest.fn().mockReturnValue(mockDownloadResumable);
      const deleteFileFn = jest.fn().mockResolvedValue(undefined);
      let readCount = 0;
      const storage = {
        getItem: jest.fn().mockImplementation(() => {
          readCount += 1;
          // First download's init is gated; the fresh download resolves.
          return readCount === 1
            ? new Promise((_, reject) => {
                rejectRead = reject;
              })
            : Promise.resolve(null);
        }),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
      };

      const downloader = new ResumableModelDownloader({
        modelConfig: mockModel,
        destinationUri: '/data/models/model.litertlm',
        storage,
        createDownloadResumableFn: factory,
        deleteFileFn,
      });

      // First download begins initialization (slow read).
      const firstStart = downloader.start();
      // Cancel during init; it waits on initPromise (which the first start
      // also awaits).
      const cancelPromise = downloader.cancel();
      // First start observes the cancel before the transfer, releases guard.
      rejectRead(new Error('storage read failed'));
      await expect(firstStart).rejects.toThrow('storage read failed');

      // A cancel that is still cleaning up must refuse a fresh start for the
      // whole cleanup (the gate is held), so its cleanup pass can never delete
      // a transfer it does not own.
      const freshStart = downloader.start();
      pauseSettled();
      await cancelPromise;
      expect(await freshStart).toBeNull();
      expect(deleteFileFn).not.toHaveBeenCalled();

      // After the cancel fully settles the gate drops, so a genuine retry
      // succeeds and its artifact is never deleted.
      const destination = await downloader.start();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(destination).toBe('/data/models/model.litertlm');
      expect(deleteFileFn).not.toHaveBeenCalled();
    });
  });
});
