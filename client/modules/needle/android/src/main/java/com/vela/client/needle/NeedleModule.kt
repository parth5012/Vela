package com.vela.client.needle

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import org.json.JSONObject

class NeedleModule : Module() {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private var isInitialized = false

    override fun definition() = ModuleDefinition {
        Name("NeedleModule")

        Events("onStream")

        Function("hasNativeLibrary") {
            try {
                NeedleNative.nativeHasLibNeedle()
            } catch (e: Throwable) {
                false
            }
        }

        AsyncFunction("init") { weightsPath: String, contextSize: Int ->
            val future = executor.submit<Boolean> {
                try {
                    val success = NeedleNative.nativeInit(weightsPath, contextSize)
                    isInitialized = success
                    success
                } catch (e: Throwable) {
                    false
                }
            }
            future.get()
        }

        AsyncFunction("complete") { prompt: String, toolsJson: String?, maxTokens: Int? ->
            val future = executor.submit<Map<String, Any?>> {
                try {
                    val tokens = maxTokens ?: 128
                    val rawResult = NeedleNative.nativeComplete(prompt, toolsJson, tokens) ?: ""

                    // Emit token stream event
                    sendEvent("onStream", mapOf(
                        "type" to "token",
                        "token" to rawResult
                    ))

                    // Parse tool call if structured JSON present
                    var toolCallStr: String? = null
                    val trimmed = rawResult.trim()
                    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                        try {
                            val json = JSONObject(trimmed)
                            if (json.has("name")) {
                                toolCallStr = trimmed
                                sendEvent("onStream", mapOf(
                                    "type" to "tool_call",
                                    "data" to toolCallStr
                                ))
                            }
                        } catch (e: Exception) {
                            // Non-JSON output
                        }
                    }

                    sendEvent("onStream", mapOf(
                        "type" to "done"
                    ))

                    mapOf(
                        "text" to rawResult,
                        "toolCalls" to toolCallStr
                    )
                } catch (e: Throwable) {
                    mapOf(
                        "text" to "Error: ${e.message}",
                        "toolCalls" to null
                    )
                }
            }
            future.get()
        }

        AsyncFunction("reset") {
            val future = executor.submit<Boolean> {
                try {
                    NeedleNative.nativeReset()
                } catch (e: Throwable) {
                    false
                }
            }
            future.get()
        }

        AsyncFunction("unload") {
            val future = executor.submit<Unit> {
                try {
                    NeedleNative.nativeFree()
                    isInitialized = false
                } catch (e: Throwable) {
                    // Ignore error on unload
                }
            }
            future.get()
        }
    }
}
