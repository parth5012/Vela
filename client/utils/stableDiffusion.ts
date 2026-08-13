import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

let SDModule: any = null;
try {
  SDModule = require('stable-diffusion').default;
} catch (e) {
  // Autolinking not compiled yet, fallback handles it
}

export let isSdModelLoaded = false;
export let useSdFallback = false;
export let sdFallbackReason: string | null = null;

export function resetSdState() {
  isSdModelLoaded = false;
  useSdFallback = false;
  sdFallbackReason = null;
}

export const SD_MODEL_STORAGE_PREFIX = 'sd_model_downloaded_';
export const SD_DEFAULT_MODEL_NAME = 'SD 1.5 LCM Q4_0';

export interface SDModelSpec {
  name: string;
  size: string;
  description: string;
  downloadUrl: string;
  filename: string;
}

export const SD_MODELS: SDModelSpec[] = [
  {
    name: 'SD 1.5 LCM Q4_0',
    size: '427MB',
    description: 'Fastest, optimized for 4GB+ RAM devices using 4-step consistency generation',
    // Mock url pointing to HuggingFace LeeJet repository for SD cpp
    downloadUrl: 'https://huggingface.co/leejet/stable-diffusion.cpp-gguf/resolve/main/sd1.5-lcm-q4_0.gguf',
    filename: 'sd1.5-lcm-q4_0.gguf',
  },
  {
    name: 'SD 1.5 Q8_0',
    size: '785MB',
    description: 'Higher quality, optimized for 8GB+ RAM devices',
    downloadUrl: 'https://huggingface.co/leejet/stable-diffusion.cpp-gguf/resolve/main/sd1.5-q8_0.gguf',
    filename: 'sd1.5-q8_0.gguf',
  }
];

export function sdModelStorageKey(modelName: string): string {
  return `${SD_MODEL_STORAGE_PREFIX}${modelName}`;
}

export async function initializeSDModel(): Promise<void> {
  if (isSdModelLoaded) return;

  useSdFallback = false;
  sdFallbackReason = null;

  if (SDModule && typeof SDModule.initializeModel === 'function') {
    try {
      const selectedModel = SD_DEFAULT_MODEL_NAME;
      const key = `${sdModelStorageKey(selectedModel)}_path`;
      const modelPath = await AsyncStorage.getItem(key);

      if (!modelPath) {
        throw new Error(`No downloaded model found for "${selectedModel}". Please download it first in Settings.`);
      }

      const cleanPath = modelPath.startsWith('file://') ? modelPath.slice(7) : modelPath;
      const success = await SDModule.initializeModel(cleanPath);
      if (!success) {
        throw new Error('Native SDK failed to initialize Stable Diffusion context.');
      }
    } catch (error: any) {
      const reason = error?.message || String(error);
      console.warn('Native Stable Diffusion initialization failed, using mock fallback:', reason);
      useSdFallback = true;
      sdFallbackReason = reason;
    }
  } else {
    useSdFallback = true;
    sdFallbackReason = 'Native StableDiffusion module unavailable in this build (Expo Go / Simulator). Using mock fallback.';
  }

  isSdModelLoaded = true;
}

export async function generateSDImage(
  prompt: string,
  negativePrompt: string = '',
  steps: number = 4,
  width: number = 512,
  height: number = 512,
  seed: number = -1
): Promise<string> {
  if (!isSdModelLoaded) {
    await initializeSDModel();
  }

  const outputDir = `${FileSystem.documentDirectory}generated-images/`;
  const fileUri = `${outputDir}img_${Date.now()}.png`;

  // Ensure output directory exists
  const dirInfo = await FileSystem.getInfoAsync(outputDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
  }

  if (!useSdFallback && SDModule && typeof SDModule.generateImage === 'function') {
    try {
      const actualSeed = seed === -1 ? Math.floor(Math.random() * 1000000) : seed;
      const resultPath: string = await SDModule.generateImage(
        prompt,
        negativePrompt,
        steps,
        width,
        height,
        actualSeed,
        fileUri
      );
      return resultPath;
    } catch (error: any) {
      console.warn('Native SD generation failed, falling back to mock generator:', error);
    }
  }

  // Fallback mode: simulate generation with a tiny delay and download a mock placeholder or return a base64 shape
  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  // Create a placeholder local image
  const svgPlaceholder = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="%232c3e50"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23ecf0f1" font-size="24">${encodeURIComponent(prompt.slice(0, 30))}</text></svg>`;
  
  await FileSystem.writeAsStringAsync(fileUri, svgPlaceholder, { encoding: FileSystem.EncodingType.UTF8 });
  return fileUri;
}
