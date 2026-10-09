package com.vela.client.sd

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
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

        AsyncFunction("getGpuInfo") {
            try {
                val hardware = Build.HARDWARE ?: ""
                val board = Build.BOARD ?: ""
                val socModel = if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        Build.SOC_MODEL ?: ""
                    } catch (_: Throwable) {
                        ""
                    }
                } else {
                    ""
                }

                var glEsVersion = ""
                try {
                    val context = appContext.reactContext
                    val activityManager = context?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                    val configInfo = activityManager?.deviceConfigurationInfo
                    if (configInfo != null) {
                        glEsVersion = configInfo.glEsVersion ?: if (configInfo.reqGlEsVersion != 0) {
                            Integer.toHexString(configInfo.reqGlEsVersion)
                        } else {
                            ""
                        }
                    }
                } catch (_: Throwable) {
                    // Safe fallback
                }

                mapOf(
                    "vendor" to hardware,
                    "hardware" to hardware,
                    "socModel" to socModel,
                    "board" to board,
                    "glEsVersion" to glEsVersion
                )
            } catch (_: Throwable) {
                mapOf(
                    "vendor" to "",
                    "hardware" to "",
                    "socModel" to "",
                    "board" to "",
                    "glEsVersion" to ""
                )
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
