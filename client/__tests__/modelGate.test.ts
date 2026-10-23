import {
  evaluateDeviceCapabilities,
  fetchRemoteModelConfig,
  checkNetworkDownloadAllowed,
  verifyArtifactIntegrity,
  recoverCorruptArtifact,
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
  });

  describe('Dynamic Remote Model Config (Never Hardcoded)', () => {
    it('fetches model artifact config from remote endpoint', async () => {
      const mockConfig: ModelArtifactConfig = {
        modelId: 'minicpm5-2b-int4',
        name: 'MiniCPM5-2B (LiteRT)',
        downloadUrl: 'https://cdn.example.com/models/MiniCPM5-2B_int4.litertlm',
        filename: 'MiniCPM5-2B_int4.litertlm',
        format: 'litertlm',
        sizeBytes: 1664299000,
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
          sizeBytes: 1664299000,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          minRamGb: 6,
          minStorageGb: 3,
        }),
      } as any);

      const config = await fetchRemoteModelConfig(undefined, mockFetch);
      expect(config.modelId).toBe('minicpm5-2b-int4');
      expect(mockFetch).toHaveBeenCalled();
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
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );

      const isValid = await verifyArtifactIntegrity(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        mockHasher
      );

      expect(isValid).toBe(true);
      expect(mockHasher).toHaveBeenCalledWith('/data/models/MiniCPM5-2B_int4.litertlm');
    });

    it('rejects file when SHA-256 does not match', async () => {
      const mockHasher = jest.fn().mockResolvedValue('corrupted_hash_value_here');

      const isValid = await verifyArtifactIntegrity(
        '/data/models/MiniCPM5-2B_int4.litertlm',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        mockHasher
      );

      expect(isValid).toBe(false);
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
          sha256: 'abc123',
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
  });
});
