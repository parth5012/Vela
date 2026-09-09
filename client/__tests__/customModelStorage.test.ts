jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc-dir/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
  copyAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

import { sniffMagicBytes } from '../utils/customModelStorage';

describe('customModelStorage magic-byte validation', () => {
  it('detects Needle 2 (0x05E12A83) and Needle 3 (0x05E12A84) as cact', () => {
    expect(sniffMagicBytes(new Uint8Array([0x83, 0x2a, 0xe1, 0x05]))).toBe('cact');
    expect(sniffMagicBytes(new Uint8Array([0x84, 0x2a, 0xe1, 0x05]))).toBe('cact');
  });

  it('detects GGUF and LiteRT task headers', () => {
    // ASCII 'GGUF'
    expect(sniffMagicBytes(new Uint8Array([0x47, 0x47, 0x55, 0x46]))).toBe('gguf');
    // PKZip header 'PK\x03\x04'
    expect(sniffMagicBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('task');
  });

  it('rejects unknown, short, and empty buffers', () => {
    expect(sniffMagicBytes(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull();
    expect(sniffMagicBytes(new Uint8Array([0x83, 0x2a]))).toBeNull();
    expect(sniffMagicBytes(new Uint8Array(0))).toBeNull();
  });
});
