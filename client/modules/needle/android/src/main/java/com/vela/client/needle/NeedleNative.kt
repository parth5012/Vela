package com.vela.client.needle

object NeedleNative {
    init {
        try {
            System.loadLibrary("needle")
        } catch (e: UnsatisfiedLinkError) {
            // Native library not found or running in test/mock environment
        }
    }

    external fun nativeInit(weightsPath: String, contextSize: Int, toolsJson: String?): Boolean
    external fun nativeComplete(prompt: String, toolsJson: String?, maxTokens: Int): String?
    external fun nativeReset(): Boolean
    external fun nativeFree(): Boolean
    external fun nativeHasLibNeedle(): Boolean
}
