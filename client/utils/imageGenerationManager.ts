import { useChatStore } from '../store/useChatStore';
import { useImageGalleryStore } from '../store/useImageGalleryStore';
import {
  checkSDHardwareReadiness,
  executeGenerateImageTool,
  cancelSDGeneration,
  resetSDCancellation,
  GenerateImageToolArgs,
  GenerateImageToolResult,
  SD_MIN_STEPS,
  SD_MAX_STEPS,
  SD_DEFAULT_STEPS,
} from './stableDiffusion';
import { shouldPromptImageConsent } from './imageGenerationConsent';

export interface ImageGenerationRequestOptions extends GenerateImageToolArgs {
  threadId?: string;
  onStepProgress?: (step: number, totalSteps: number) => void;
  skipConsent?: boolean;
}

export interface ImageGenerationProcessResult {
  status: 'completed' | 'needs_consent' | 'cancelled' | 'hardware_blocked' | 'error';
  result?: GenerateImageToolResult;
  messageId?: string;
  reason?: string;
}

/**
 * Orchestrates on-device image generation from user prompt to chat feed insertion.
 * Implements Map #565 Decisions:
 * 1. Scope: text-to-image
 * 4. Defaults: 512x512, 20 steps, seed
 * 6. Save: explicit Save + Share
 * 7. Progress: step count + cancel
 * 10. Insert generated image into chat as assistant message with metadata/actions
 * 11. Confirm on first use and when steps > 25 (or low battery)
 */
export async function runImageGenerationPipeline(
  options: ImageGenerationRequestOptions
): Promise<ImageGenerationProcessResult> {
  resetSDCancellation();
  const requestedSteps = options.steps && options.steps > 0 ? Math.round(options.steps) : SD_DEFAULT_STEPS;
  const steps = Math.min(SD_MAX_STEPS, Math.max(SD_MIN_STEPS, requestedSteps));

  // 1. Hardware Readiness Guardrail
  const hardware = await checkSDHardwareReadiness();
  if (!hardware.canRun) {
    return {
      status: 'hardware_blocked',
      reason: hardware.reason || 'Device hardware does not meet the 6GB RAM floor for on-device generation.',
    };
  }

  // 2. Consent Check
  if (!options.skipConsent) {
    const needsConsent = await shouldPromptImageConsent(steps, hardware.batteryLevel);
    if (needsConsent) {
      return {
        status: 'needs_consent',
        reason: 'User confirmation required prior to on-device generation.',
      };
    }
  }

  // 3. Execution
  const toolResult = await executeGenerateImageTool(
    {
      prompt: options.prompt,
      negative_prompt: options.negative_prompt,
      steps,
      seed: options.seed,
    },
    options.onStepProgress
  );

  if (!toolResult.success) {
    if (toolResult.error?.toLowerCase().includes('cancel')) {
      return {
        status: 'cancelled',
        reason: 'Generation cancelled by user.',
        result: toolResult,
      };
    }
    return {
      status: 'error',
      reason: toolResult.error || 'Failed to generate image.',
      result: toolResult,
    };
  }

  // 4. Chat Feed Insertion (Decision #10)
  let createdMessageId: string | undefined = undefined;
  if (options.threadId && toolResult.imageUri) {
    createdMessageId = `msg-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const assistantMessage = {
      id: createdMessageId,
      role: 'assistant' as const,
      content: `Generated image for: "${toolResult.prompt}"\n\n*Parameters: 512×512, ${toolResult.steps} steps, seed #${toolResult.seed}*`,
      created_at: nowIso,
      attachments: [
        {
          id: `att-gen-${Date.now()}`,
          storage_path: toolResult.imageUri,
          mime_type: 'image/png',
          file_size: 512 * 512 * 4,
          url: toolResult.imageUri,
          alt_text: toolResult.prompt,
          width: 512,
          height: 512,
        },
      ],
    };

    useChatStore.getState().addMessage(options.threadId, assistantMessage);
  }

  // 5. Gallery & History Persistence (Map #570)
  if (toolResult.imageUri) {
    try {
      await useImageGalleryStore.getState().saveGeneratedImage({
        prompt: toolResult.prompt,
        negativePrompt: options.negative_prompt,
        model: 'Stable Diffusion 1.5 (INT8)',
        width: toolResult.width,
        height: toolResult.height,
        steps: toolResult.steps,
        seed: toolResult.seed,
        sourceUri: toolResult.imageUri,
      });
    } catch (galleryErr) {
      console.warn('[ImageGenerationManager] Could not save to gallery store:', galleryErr);
    }
  }

  return {
    status: 'completed',
    result: toolResult,
    messageId: createdMessageId,
  };
}

export function abortActiveImageGeneration(): void {
  cancelSDGeneration();
}
