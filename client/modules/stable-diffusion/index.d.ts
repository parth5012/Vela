interface StableDiffusionNative {
  initializeModel(modelPath: string): Promise<boolean>;
  getGpuInfo?(): Promise<{
    vendor?: string;
    hardware?: string;
    socModel?: string;
    board?: string;
    glEsVersion?: string;
  }>;
  generateImage(
    prompt: string,
    negativePrompt: string,
    steps: number,
    width: number,
    height: number,
    seed: number,
    outputPath: string
  ): Promise<string>;
}

declare const _default: StableDiffusionNative;
export default _default;
