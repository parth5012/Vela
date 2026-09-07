#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>
#include "needle.h"

#define TAG "NeedleJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static bool g_initialized = false;

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeInit(
    JNIEnv* env,
    jobject /* this */,
    jstring jWeightsPath,
    jint contextSize
) {
    if (!jWeightsPath) {
        LOGE("nativeInit: jWeightsPath is null");
        return JNI_FALSE;
    }
    const char* weightsPath = env->GetStringUTFChars(jWeightsPath, nullptr);
    if (!weightsPath) {
        return JNI_FALSE;
    }
    LOGI("nativeInit called with weightsPath=%s contextSize=%d", weightsPath, contextSize);

#if HAVE_NEEDLE_SO
    int rc = needle_init("", "[]", weightsPath);
    env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
    g_initialized = (rc == 0);
    return g_initialized ? JNI_TRUE : JNI_FALSE;
#else
    LOGI("HAVE_NEEDLE_SO is 0; initializing mock fallback engine");
    env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
    g_initialized = true;
    return JNI_TRUE;
#endif
}

JNIEXPORT jstring JNICALL
Java_com_vela_client_needle_NeedleNative_nativeComplete(
    JNIEnv* env,
    jobject /* this */,
    jstring jPrompt,
    jstring jToolsJson,
    jint maxTokens
) {
    if (!g_initialized) {
        LOGE("Needle engine not initialized");
        return env->NewStringUTF("Error: Needle engine not initialized");
    }

    if (!jPrompt) {
        LOGE("nativeComplete: jPrompt is null");
        return env->NewStringUTF("Error: prompt cannot be null");
    }

    const char* prompt = env->GetStringUTFChars(jPrompt, nullptr);
    if (!prompt) {
        return env->NewStringUTF("Error: failed to decode prompt");
    }
    const char* toolsJson = jToolsJson ? env->GetStringUTFChars(jToolsJson, nullptr) : nullptr;

#if HAVE_NEEDLE_SO
    std::vector<char> outputBuffer(4096, 0);
    int rc = needle_complete(prompt, maxTokens, outputBuffer.data(), outputBuffer.size() - 1);
    env->ReleaseStringUTFChars(jPrompt, prompt);
    if (jToolsJson && toolsJson) env->ReleaseStringUTFChars(jToolsJson, toolsJson);

    if (rc == 0) {
        return env->NewStringUTF(outputBuffer.data());
    } else {
        return env->NewStringUTF("Error in needle_complete inference");
    }
#else
    LOGI("Generating mock response for prompt: %s", prompt);
    std::string promptStr(prompt ? prompt : "");
    env->ReleaseStringUTFChars(jPrompt, prompt);
    if (jToolsJson && toolsJson) env->ReleaseStringUTFChars(jToolsJson, toolsJson);

    std::string response;
    if (promptStr.find("click") != std::string::npos || promptStr.find("tap") != std::string::npos) {
        response = "{\"name\": \"device_click\", \"arguments\": {\"x\": 540, \"y\": 1120}, \"confidence\": 0.96}";
    } else if (promptStr.find("type") != std::string::npos || promptStr.find("text") != std::string::npos) {
        response = "{\"name\": \"device_type\", \"arguments\": {\"text\": \"Hello\"}, \"confidence\": 0.94}";
    } else {
        response = "{\"name\": \"device_screen_read\", \"arguments\": {}, \"confidence\": 0.95}";
    }

    return env->NewStringUTF(response.c_str());
#endif
}

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeReset(
    JNIEnv* env,
    jobject /* this */
) {
#if HAVE_NEEDLE_SO
    int rc = needle_reset();
    return (rc == 0) ? JNI_TRUE : JNI_FALSE;
#else
    return JNI_TRUE;
#endif
}

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeFree(
    JNIEnv* env,
    jobject /* this */
) {
    g_initialized = false;
#if HAVE_NEEDLE_SO
    int rc = needle_free();
    return (rc == 0) ? JNI_TRUE : JNI_FALSE;
#else
    return JNI_TRUE;
#endif
}

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeHasLibNeedle(
    JNIEnv* env,
    jobject /* this */
) {
#if HAVE_NEEDLE_SO
    return JNI_TRUE;
#else
    return JNI_FALSE;
#endif
}

} // extern "C"
