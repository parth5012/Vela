import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCustomModels,
  saveCustomModel,
  deleteCustomModel,
  importModelFromFile,
  preflightUrlMagicBytes,
  CustomModelRecord,
} from '../utils/customModelStorage';
import { getDynamicModelStatusForRam } from '../utils/ramDetection';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc-dir/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 45000000 }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(true),
  deleteAsync: jest.fn().mockResolvedValue(true),
  copyAsync: jest.fn().mockResolvedValue(true),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(true),
  createDownloadResumable: jest.fn(),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

describe('Custom Model UI Integration & Management', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('correctly associates dynamic RAM status with custom models', () => {
    const customCact: CustomModelRecord = {
      id: 'needle-custom',
      name: 'Custom Needle',
      format: 'cact',
      sizeBytes: 45 * 1024 * 1024, // 45MB
      localUri: 'file:///mock/needle.cact',
      source: 'document_picker',
      downloadDate: new Date().toISOString(),
    };

    const ramBytes = 4 * 1024 * 1024 * 1024; // 4GB
    const status = getDynamicModelStatusForRam(customCact.sizeBytes, customCact.format, ramBytes);
    expect(status).toBe('recommended');
  });

  it('persists and deletes imported custom models', async () => {
    const record = await importModelFromFile(
      'file:///cache/imported-model.cact',
      'imported-model.cact'
    );

    expect(record.format).toBe('cact');
    expect(record.name).toBe('imported-model');

    const list = await getCustomModels();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(record.id);

    const deleted = await deleteCustomModel(record.id);
    expect(deleted).toBe(true);
    expect((await getCustomModels()).length).toBe(0);
  });
});
