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

        // #298: toolsJson is the statically-declared tool array baked into the
        // engine prefix by needle_init — the JSON-extraction screen passes the
        // Owner's schema as the ONLY tool. Empty/absent keeps the chat default
        // ("[]", tools travel in the prompt).
        AsyncFunction("init") { weightsPath: String, contextSize: Int, systemPrompt: String?, toolIndexPath: String?, toolsJson: String? ->
            val future = executor.submit<Boolean> {
                try {
                    val success = NeedleNative.nativeInit(weightsPath, contextSize, systemPrompt, toolIndexPath, toolsJson)
                    isInitialized = success
                    success
                } catch (e: Throwable) {
                    isInitialized = false
                    false
                }
            }
            val success = future.get()
            if (!success) {
                // Surface needle_last_error() through the app's existing error
                // path: localLlm catches the rejection and records the reason as
                // the honest mock-fallback message (no pretending).
                val detail = try {
                    NeedleNative.nativeLastError()
                } catch (t: Throwable) {
                    null
                }
                if (detail != null) {
                    throw Exception(detail)
                }
            }
            success
        }

        AsyncFunction("complete") { prompt: String, toolsJson: String?, maxTokens: Int? ->
            val future = executor.submit<Map<String, Any?>> {
                try {
                    val tokens = maxTokens ?: 128
                    val rawResult = NeedleNative.nativeComplete(prompt, toolsJson, tokens) ?: ""

                    // Parse structured tool output first and emit EXACTLY ONE stream
                    // event per completion: refusal / tool_call / token. Emitting both
                    // `token` and `tool_call` for the same payload made the JS side
                    // stream the JSON twice (#295).
                    var toolCallStr: String? = null
                    val trimmed = rawResult.trim()
                    var eventType = "token"
                    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                        try {
                            val json = JSONObject(trimmed)
                            // Real engine shape: {type:'call', function_calls:[{name,arguments}],
                            // reasoning, confidence}. An empty function_calls [] means the model
                            // refused to call a tool (#295).
                            val fnCalls = json.optJSONArray("function_calls")
                            // Never bridge NaN or the literal string "null": optDouble() returns
                            // NaN for absent/non-numeric values and optString() stringifies
                            // JSONObject.NULL, and both blow up the Expo event bridge.
                            val reasoning: String? =
                                if (json.has("reasoning") && !json.isNull("reasoning"))
                                    json.optString("reasoning", "")
                                else null
                            val confidence: Double? =
                                if (json.has("confidence") && !json.isNull("confidence"))
                                    json.optDouble("confidence").takeUnless { it.isNaN() }
                                else null
                            val refused = fnCalls != null && fnCalls.length() == 0
                            val hasCall =
                                if (fnCalls != null) fnCalls.length() > 0 else json.has("name")

                            when {
                                refused -> eventType = "refusal"
                                hasCall -> {
                                    eventType = "tool_call"
                                    toolCallStr = trimmed
                                }
                            }

                            if (eventType != "token") {
                                // Only non-null extras are attached, so the bridge never
                                // sees a null reasoning/confidence key.
                                val event = mutableMapOf<String, Any?>(
                                    "type" to eventType,
                                    "data" to trimmed
                                )
                                reasoning?.let { event["reasoning"] = it }
                                confidence?.let { event["confidence"] = it }
                                sendEvent("onStream", event)
                            }
                        } catch (e: Exception) {
                            // Non-JSON output → fall through to the plain token event
                        }
                    }
                    if (eventType == "token") {
                        sendEvent("onStream", mapOf(
                            "type" to "token",
                            "token" to rawResult
                        ))
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

        AsyncFunction("embed") { input: String ->
            // #299: needle_embed plumbing. null means "no vector" — the engine
            // is a mock, uninitialized, or a Needle 2 build — so the JS side
            // degrades to FTS5-only instead of receiving fabricated data.
            val future = executor.submit<FloatArray?> {
                try {
                    NeedleNative.nativeEmbed(input)
                } catch (e: Throwable) {
                    null
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
