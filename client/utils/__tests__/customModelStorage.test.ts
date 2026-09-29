import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import {
  sniffMagicBytes,
  sniffNeedleVariant,
  preflightUrlMagicBytes,
  validateFileMagicBytes,
  getCustomModels,
  saveCustomModel,
  deleteCustomModel,
  importModelFromFile,
  startCustomModelDownload,
  pauseCustomModelDownload,
  resumeCustomModelDownload,
  cancelCustomModelDownload,
  CustomModelRecord,
} from '../customModelStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockDownloadResumable = {
  downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock/model.cact' }),
  pauseAsync: jest.fn().mockResolvedValue({ fileOffset: 1024, url: 'https://example.com/model.cact' }),
  resumeAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock/model.cact' }),
};

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc-dir/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 50000000 }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(true),
  deleteAsync: jest.fn().mockResolvedValue(true),
  copyAsync: jest.fn().mockResolvedValue(true),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(true),
  createDownloadResumable: jest.fn(() => mockDownloadResumable),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

describe('customModelStorage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  describe('sniffMagicBytes', () => {
    it('identifies Needle 2 (.cact) magic bytes 0x05E12A83 (83 2A E1 05)', () => {
      const bytes = new Uint8Array([0x83, 0x2a, 0xe1, 0x05, 0x00, 0x00]);
      expect(sniffMagicBytes(bytes)).toBe('cact');
    });

    it('identifies Needle 3 (.cact) magic bytes 0x05E12A84 (84 2A E1 05)', () => {
      const bytes = new Uint8Array([0x84, 0x2a, 0xe1, 0x05, 0x00, 0x00]);
      expect(sniffMagicBytes(bytes)).toBe('cact');
    });

    it('identifies GGUF magic bytes "GGUF" (0x47, 0x47, 0x55, 0x46)', () => {
      const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 0x03, 0x00]);
      expect(sniffMagicBytes(bytes)).toBe('gguf');
    });

    it('identifies LiteRT PKZip (.task) magic bytes (0x50, 0x4b, 0x03, 0x04)', () => {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
      expect(sniffMagicBytes(bytes)).toBe('task');
    });

    it('returns null for unknown magic bytes', () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(sniffMagicBytes(bytes)).toBeNull();
    });
  });

  // #296 — per-version reporting. Research #292: 0x05E12A83 = needle2,
  // 0x05E12A84 = needle3 (LE 83 2A E1 05 / 84 2A E1 05). Both are valid .cact,
  // but preflight/validate must report WHICH needle variant, not lump them.
  describe('per-version .cact magic reporting (#296)', () => {
    const NEEDLE2_HEADER = [0x83, 0x2a, 0xe1, 0x05, 0x01, 0x00];
    const NEEDLE3_HEADER = [0x84, 0x2a, 0xe1, 0x05, 0x01, 0x00];
    const realFetch = global.fetch;

    afterEach(() => {
      (global as any).fetch = realFetch;
    });

    const mockPreflightResponse = (header: number[], contentLength: number) => {
      const value = new Uint8Array(header);
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 206,
        headers: {
          get: (key: string) =>
            key.toLowerCase() === 'content-range' ? `bytes 0-15/${contentLength}` : null,
        },
        body: {
          getReader: () => ({
            read: async () => ({ value }),
            cancel: jest.fn(),
          }),
        },
      });
    };

    it('distinguishes needle2 (0x05E12A83) from needle3 (0x05E12A84)', () => {
      expect(sniffNeedleVariant(new Uint8Array(NEEDLE2_HEADER))).toBe('needle2');
      expect(sniffNeedleVariant(new Uint8Array(NEEDLE3_HEADER))).toBe('needle3');
      expect(sniffMagicBytes(new Uint8Array(NEEDLE2_HEADER))).toBe('cact');
      expect(sniffMagicBytes(new Uint8Array(NEEDLE3_HEADER))).toBe('cact');
    });

    it('reports a null variant for gguf, task, unknown, and short headers', () => {
      expect(sniffNeedleVariant(new Uint8Array([0x47, 0x47, 0x55, 0x46]))).toBeNull();
      expect(sniffNeedleVariant(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
      expect(sniffNeedleVariant(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
      expect(sniffNeedleVariant(new Uint8Array([0x83, 0x2a]))).toBeNull();
    });

    it('preflightUrlMagicBytes reports needle3 (0x84) distinctly, with size', async () => {
      mockPreflightResponse(NEEDLE3_HEADER, 35335380);
      const res = await preflightUrlMagicBytes('https://example.com/needle3.cact');
      expect(res.valid).toBe(true);
      expect(res.format).toBe('cact');
      expect(res.variant).toBe('needle3');
      expect(res.contentLength).toBe(35335380);
    });

    it('preflightUrlMagicBytes reports needle2 (0x83) distinctly, with size', async () => {
      mockPreflightResponse(NEEDLE2_HEADER, 13737807);
      const res = await preflightUrlMagicBytes('https://example.com/needle2.cact');
      expect(res.valid).toBe(true);
      expect(res.format).toBe('cact');
      expect(res.variant).toBe('needle2');
      expect(res.contentLength).toBe(13737807);
    });

    it('preflightUrlMagicBytes reports a null variant for non-cact headers', async () => {
      mockPreflightResponse([0x47, 0x47, 0x55, 0x46], 9000);
      const res = await preflightUrlMagicBytes('https://example.com/model.gguf');
      expect(res.valid).toBe(true);
      expect(res.format).toBe('gguf');
      expect(res.variant).toBeNull();
    });

    it('validateFileMagicBytes reports needle2 vs needle3 distinctly', async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(
        Buffer.from(NEEDLE2_HEADER).toString('base64')
      );
      const v2 = await validateFileMagicBytes('file:///mock/needle2.cact');
      expect(v2.format).toBe('cact');
      expect(v2.variant).toBe('needle2');
      expect(v2.valid).toBe(true);

      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(
        Buffer.from(NEEDLE3_HEADER).toString('base64')
      );
      const v3 = await validateFileMagicBytes('file:///mock/needle3.cact');
      expect(v3.format).toBe('cact');
      expect(v3.variant).toBe('needle3');
      expect(v3.valid).toBe(true);
    });

    it('validateFileMagicBytes reports a null variant for unreadable/unknown files', async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce('');
      const empty = await validateFileMagicBytes('file:///mock/empty.cact');
      expect(empty).toEqual({ format: null, variant: null, valid: false });

      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(
        Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64')
      );
      const unknown = await validateFileMagicBytes('file:///mock/unknown.bin');
      expect(unknown).toEqual({ format: null, variant: null, valid: false });
    });
  });

  describe('CRUD Model Manifest', () => {
    it('saves and retrieves custom models from AsyncStorage', async () => {
      const models = await getCustomModels();
      expect(models).toEqual([]);

      const newModel: CustomModelRecord = {
        id: 'cact-test-1',
        name: 'Needle 45M Fast',
        format: 'cact',
        sizeBytes: 45000000,
        localUri: 'file:///mock-doc-dir/models/cact/cact-test-1.cact',
        source: 'url',
        sourceUrl: 'https://example.com/needle.cact',
        downloadDate: new Date().toISOString(),
      };

      await saveCustomModel(newModel);

      const retrieved = await getCustomModels();
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].id).toBe('cact-test-1');
      expect(retrieved[0].name).toBe('Needle 45M Fast');
    });

    it('deletes custom model and removes local file', async () => {
      const newModel: CustomModelRecord = {
        id: 'to-delete',
        name: 'Obsolete Model',
        format: 'gguf',
        sizeBytes: 1000,
        localUri: 'file:///mock-doc-dir/models/gguf/to-delete.gguf',
        source: 'document_picker',
        downloadDate: new Date().toISOString(),
      };

      await saveCustomModel(newModel);
      expect((await getCustomModels()).length).toBe(1);

      const deleted = await deleteCustomModel('to-delete');
      expect(deleted).toBe(true);
      expect(FileSystem.deleteAsync).toHaveBeenCalled();
      expect((await getCustomModels()).length).toBe(0);
    });
  });

  describe('Resumable download lifecycle', () => {
    it('manages start, pause, and resume', async () => {
      let resolveDownload: any;
      mockDownloadResumable.downloadAsync.mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveDownload = resolve;
        })
      );

      const progressCb = jest.fn();
      const promise = startCustomModelDownload({
        id: 'dl-test',
        name: 'Download Test',
        url: 'https://example.com/model.cact',
        format: 'cact',
      }, progressCb);

      // Wait a tick for async dir/storage check
      await new Promise((r) => setTimeout(r, 10));

      expect(FileSystem.createDownloadResumable).toHaveBeenCalled();

      await pauseCustomModelDownload('dl-test');
      expect(mockDownloadResumable.pauseAsync).toHaveBeenCalled();

      // Resolve download in-flight to let start promise finish
      resolveDownload({ uri: 'file:///mock/model.cact' });
      await promise;

      await resumeCustomModelDownload('dl-test', progressCb).catch(() => {});
      await cancelCustomModelDownload('dl-test');
    });
  });
});
