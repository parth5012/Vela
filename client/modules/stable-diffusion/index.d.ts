interface StableDiffusionNative {
  initializeModel(modelPath: string): Promise<boolean>;
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
