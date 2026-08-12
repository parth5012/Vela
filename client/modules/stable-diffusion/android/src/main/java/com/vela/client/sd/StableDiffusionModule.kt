package com.vela.client.sd

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream

class StableDiffusionModule : Module() {
    companion object {
        init {
            System.loadLibrary("stable-diffusion")
        }
    }

    override fun definition() = ModuleDefinition {
        Name("StableDiffusionModule")

        // Store active C++ context handle
        var ctxHandle: Long = 0

        AsyncFunction("initializeModel") { modelPath: String ->
            try {
                if (ctxHandle != 0L) {
                    // Already initialized
                    return@AsyncFunction true
                }
                ctxHandle = initSD(modelPath, null, null, null, 0.0f, 4, "q4_0", true)
                ctxHandle != 0L
            } catch (e: Exception) {
                ctxHandle = 0L
                false
            }
        }

        AsyncFunction("generateImage") { prompt: String, negativePrompt: String, steps: Int, width: Int, height: Int, seed: Int, outputPath: String ->
            if (ctxHandle == 0L) {
                throw IllegalStateException("Model context is not initialized")
            }

            try {
                val success = txt2img(ctxHandle, prompt, negativePrompt, 7.5f, width, height, steps, seed, outputPath)
                if (success) {
                    outputPath
                } else {
                    throw RuntimeException("txt2img inference failed in native module library")
                }
            } catch (e: Exception) {
                throw RuntimeException("Generation error: ${e.message}", e)
            }
        }
    }

    // Bridge JNI calls
    private external fun initSD(modelPath: String, vaePath: String?, t2iAdapterPath: String?, loraPath: String?, loraWeight: Float, nThreads: Int, wtype: String, useVulkan: Boolean): Long
    private external fun txt2img(ctxHandle: Long, prompt: String, negativePrompt: String, cfgScale: Float, width: Int, height: Int, sampleSteps: Int, seed: Int, outputPath: String): Boolean
}
