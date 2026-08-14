#include <jni.h>
#include <string>
#include <android/log.h>

#define LOG_TAG "StableDiffusion"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_vela_client_sd_StableDiffusionModule_initSD(
    JNIEnv* env, jobject thiz, jstring modelPath,
    jstring loraPath, jstring controlNetPath, jstring embedPath,
    jfloat guidanceScale, jint numSteps, jstring quantType, jboolean useVulkan);

JNIEXPORT jboolean JNICALL
Java_com_vela_client_sd_StableDiffusionModule_txt2img(
    JNIEnv* env, jobject thiz, jlong ctx,
    jstring prompt, jstring negativePrompt, jfloat guidanceScale,
    jint width, jint height, jint steps, jint seed, jstring outputPath);

JNIEXPORT void JNICALL
Java_com_vela_client_sd_StableDiffusionModule_cleanupSD(
    JNIEnv* env, jobject thiz, jlong ctx);

}
