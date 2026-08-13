import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { initializeSDModel, generateSDImage, isSdModelLoaded, useSdFallback, resetSdState } from '../utils/stableDiffusion';

let mockSDModule: any;

jest.mock('stable-diffusion', () => ({
  default: {
    initializeModel: jest.fn(),
    generateImage: jest.fn(),
  },
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return actual;
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-document-dir/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(true),
  writeAsStringAsync: jest.fn().mockResolvedValue(true),
  EncodingType: { UTF8: 'utf8' },
}));

describe('stableDiffusion utility', () => {
  beforeEach(() => {
    jest.clearAllMocks(); resetSdState();
    mockSDModule = (require('stable-diffusion') as any).default;;
  });

  it('performs mock fallback when native module throws or fails', async () => {
    mockSDModule.initializeModel.mockRejectedValueOnce(new Error('Native initialization failed'));

    await initializeSDModel();

    expect(isSdModelLoaded).toBe(true);
    expect(useSdFallback).toBe(true);

    const path = await generateSDImage('a cozy cottage');
    expect(path).toContain('file:///mock-document-dir/generated-images/img_');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
  });

  it('initializes native module if model path is set', async () => {
    await AsyncStorage.setItem('sd_model_downloaded_SD 1.5 LCM Q4_0_path', '/path/to/lcm.gguf');
    mockSDModule.initializeModel.mockResolvedValueOnce(true);

    await initializeSDModel();

    expect(mockSDModule.initializeModel).toHaveBeenCalledWith('/path/to/lcm.gguf');
  });
});
