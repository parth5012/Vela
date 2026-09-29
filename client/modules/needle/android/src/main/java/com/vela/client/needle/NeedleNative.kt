package com.vela.client.needle

object NeedleNative {
    init {
        try {
            System.loadLibrary("needle")
        } catch (e: UnsatisfiedLinkError) {
            // Native library not found or running in test/mock environment
        }
    }

    external fun nativeInit(
        weightsPath: String,
        contextSize: Int,
        systemPrompt: String?,
        toolIndexPath: String?
    ): Boolean
    external fun nativeComplete(prompt: String, toolsJson: String?, maxTokens: Int): String?
    external fun nativeReset(): Boolean
    external fun nativeFree(): Boolean
    external fun nativeHasLibNeedle(): Boolean

    // needle_last_error() text for the most recent engine failure, or null.
    external fun nativeLastError(): String?

    // needle_embed() plumbing only (#299 wires the feature); null when the
    // linked engine is a mock or a Needle 2 build.
    external fun nativeEmbed(input: String): FloatArray?
}
