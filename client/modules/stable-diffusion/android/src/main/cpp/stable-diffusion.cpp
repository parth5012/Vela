#include <jni.h>
#include <string>
#include <android/log.h>

#define LOG_TAG "StableDiffusion"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

struct SDContext {
    std::string modelPath;
    bool initialized;
    SDContext() : initialized(false) {}
};

static SDContext* g_ctx = nullptr;

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_vela_client_sd_StableDiffusionModule_initSD(
    JNIEnv* env, jobject thiz, jstring modelPath,
    jstring /*loraPath*/, jstring /*controlNetPath*/, jstring /*embedPath*/,
    jfloat /*guidanceScale*/, jint /*numSteps*/, jstring /*quantType*/, jboolean /*useVulkan*/) {
    if (g_ctx) {
        delete g_ctx;
        g_ctx = nullptr;
    }
    g_ctx = new SDContext();
    if (modelPath) {
        const char* path = env->GetStringUTFChars(modelPath, nullptr);
        g_ctx->modelPath = std::string(path);
        env->ReleaseStringUTFChars(modelPath, path);
    }
    g_ctx->initialized = true;
    LOGI("SD model path: %s", g_ctx->modelPath.c_str());
    return reinterpret_cast<jlong>(g_ctx);
}

JNIEXPORT jboolean JNICALL
Java_com_vela_client_sd_StableDiffusionModule_txt2img(
    JNIEnv* env, jobject thiz, jlong ctx,
    jstring prompt, jstring negativePrompt, jfloat guidanceScale,
    jint width, jint height, jint steps, jint seed, jstring outputPath) {
    if (!ctx) return false;
    auto* context = reinterpret_cast<SDContext*>(ctx);
    if (!context->initialized) return false;
    LOGI("Generating image: size=%dx%d, steps=%d", width, height, steps);
    return true;
}

JNIEXPORT void JNICALL
Java_com_vela_client_sd_StableDiffusionModule_cleanupSD(
    JNIEnv* env, jobject thiz, jlong ctx) {
    auto* context = reinterpret_cast<SDContext*>(ctx);
    if (context) {
        delete context;
        g_ctx = nullptr;
    }
}

}
