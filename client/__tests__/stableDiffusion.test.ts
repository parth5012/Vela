import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import {
  initializeSDModel,
  generateSDImage,
  isSdModelLoaded,
  useSdFallback,
  resetSdState,
  SD_MODELS,
  SD_DEFAULT_MODEL_NAME,
  getSDModelSpec,
  isSDModelDownloaded,
  getSDModelPath,
  downloadSDModel,
  deleteSDModel,
  checkSDHardwareReadiness,
  cancelSDGeneration,
  executeGenerateImageTool,
} from '../utils/stableDiffusion';

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
  getInfoAsync: jest.fn().mockImplementation((path: string) => {
    return Promise.resolve({ exists: true, uri: path });
  }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(true),
  writeAsStringAsync: jest.fn().mockResolvedValue(true),
  deleteAsync: jest.fn().mockResolvedValue(true),
  downloadAsync: jest.fn().mockImplementation((url: string, dest: string) =>
    Promise.resolve({ uri: dest, status: 200 })
  ),
  createDownloadResumable: jest.fn().mockImplementation((url: string, dest: string, opts: any, callback: any) => ({
    downloadAsync: jest.fn().mockImplementation(async () => {
      if (callback) {
        callback({ totalBytesWritten: 1000, totalBytesExpectedToWrite: 1000 });
      }
      return { uri: dest, status: 200 };
    }),
  })),
  EncodingType: { UTF8: 'utf8' },
}));

jest.mock('expo-file-system/legacy', () => require('expo-file-system'));

jest.mock('../utils/ramDetection', () => ({
  detectRamBytes: jest.fn().mockResolvedValue(8 * 1024 * 1024 * 1024),
}));

describe('stableDiffusion utility', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    resetSdState();
    mockSDModule = (require('stable-diffusion') as any).default;
  });

  it('exposes defined models with specs', () => {
    expect(SD_MODELS.length).toBeGreaterThanOrEqual(2);
    const defaultModel = getSDModelSpec(SD_DEFAULT_MODEL_NAME);
    expect(defaultModel).toBeDefined();
    expect(defaultModel?.name).toBe('SD 1.5 LCM Q4_0');
    expect(defaultModel?.downloadUrl).toContain('huggingface.co');
  });

  it('performs mock fallback when native module throws or fails', async () => {
    mockSDModule.initializeModel.mockRejectedValueOnce(new Error('Native initialization failed'));

    await initializeSDModel();

    expect(isSdModelLoaded).toBe(true);
    expect(useSdFallback).toBe(true);

    const path = await generateSDImage('a cozy cottage', '', 1);
    expect(path).toContain('file:///mock-document-dir/generated-images/img_');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
  });

  it('initializes native module if model path is set', async () => {
    await AsyncStorage.setItem('sd_model_downloaded_SD 1.5 LCM Q4_0_path', '/path/to/lcm.gguf');
    mockSDModule.initializeModel.mockResolvedValueOnce(true);

    await initializeSDModel();

    expect(mockSDModule.initializeModel).toHaveBeenCalledWith('/path/to/lcm.gguf');
  });

  it('checks if a model is downloaded based on flag and disk existence', async () => {
    // When no flag is set, returns false
    const notSet = await isSDModelDownloaded('SD 1.5 LCM Q4_0');
    expect(notSet).toBe(false);

    // When flag is set but file missing on disk, returns false
    await AsyncStorage.setItem('sd_model_downloaded_SD 1.5 LCM Q4_0', 'true');
    await AsyncStorage.setItem('sd_model_downloaded_SD 1.5 LCM Q4_0_path', 'file:///mock-document-dir/models/sd/sd1.5-lcm-q4_0.gguf');
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });
    const fileMissing = await isSDModelDownloaded('SD 1.5 LCM Q4_0');
    expect(fileMissing).toBe(false);

    // When flag is set and file exists on disk, returns true
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    const downloaded = await isSDModelDownloaded('SD 1.5 LCM Q4_0');
    expect(downloaded).toBe(true);

    const path = await getSDModelPath('SD 1.5 LCM Q4_0');
    expect(path).toBe('file:///mock-document-dir/models/sd/sd1.5-lcm-q4_0.gguf');
  });

  it('downloads model and records storage keys', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

    let progressCalled = false;
    const dest = await downloadSDModel('SD 1.5 LCM Q4_0', (downloaded, total) => {
      progressCalled = true;
      expect(downloaded).toBe(total);
    });

    expect(dest).toContain('sd1.5-lcm-q4_0.gguf');
    expect(progressCalled).toBe(true);
    expect(await AsyncStorage.getItem('sd_model_downloaded_SD 1.5 LCM Q4_0')).toBe('true');
  });

  it('deletes model from disk and async storage', async () => {
    await AsyncStorage.setItem('sd_model_downloaded_SD 1.5 LCM Q4_0', 'true');
    await AsyncStorage.setItem('sd_model_downloaded_SD 1.5 LCM Q4_0_path', 'file:///mock-document-dir/models/sd/sd1.5-lcm-q4_0.gguf');
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });

    await deleteSDModel('SD 1.5 LCM Q4_0');

    expect(FileSystem.deleteAsync).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('sd_model_downloaded_SD 1.5 LCM Q4_0')).toBeNull();
  });

  it('evaluates hardware readiness against the 6GB RAM floor', async () => {
    const readiness = await checkSDHardwareReadiness();
    expect(readiness.ramFloorPassed).toBe(true);
    expect(readiness.canRun).toBe(true);
  });

  it('handles cancellation gracefully during generation', async () => {
    cancelSDGeneration();
    await expect(generateSDImage('test prompt', '', 3)).rejects.toThrow('cancelled by the user');
  });

  it('executes generate_image tool wrapper successfully', async () => {
    const result = await executeGenerateImageTool({
      prompt: 'a futuristic cyberpunk city at dusk',
      steps: 1,
    });

    expect(result.success).toBe(true);
    expect(result.imageUri).toContain('img_');
    expect(result.prompt).toBe('a futuristic cyberpunk city at dusk');
    expect(result.steps).toBe(1);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
  });

  it('fails tool execution if prompt is empty', async () => {
    const result = await executeGenerateImageTool({ prompt: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Prompt cannot be empty');
  });

  it('fails tool execution if prompt exceeds 1000 characters', async () => {
    const result = await executeGenerateImageTool({ prompt: 'a'.repeat(1005) });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Prompt exceeds maximum length');
  });

  it('rejects deletion of unknown model', async () => {
    await expect(deleteSDModel('Nonexistent Model')).rejects.toThrow('Cannot delete unknown model');
  });

  it('shares in-flight promise for concurrent download requests', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

    const p1 = downloadSDModel('SD 1.5 LCM Q4_0');
    const p2 = downloadSDModel('SD 1.5 LCM Q4_0');

    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
  });
});
