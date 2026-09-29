#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include "needle.h"

#define TAG "NeedleJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// HAVE_NEEDLE_ENGINE=1 when the static engine archive was linked in
// (CMakeLists.txt); NEEDLE_ENGINE_GENERATION is 3 or 2. Both are set by the
// build; the fallbacks keep a bare `g++ -c` sane.
#ifndef HAVE_NEEDLE_ENGINE
#define HAVE_NEEDLE_ENGINE 0
#endif
#ifndef NEEDLE_ENGINE_GENERATION
#define NEEDLE_ENGINE_GENERATION 3
#endif

static bool g_initialized = false;

// Last failure text from needle_last_error() (or a local I/O failure), exposed
// to Kotlin via nativeLastError() so the app can surface the real reason.
static std::string g_last_error;

static void setLastError(const std::string& message) {
    g_last_error = message;
}

#if HAVE_NEEDLE_ENGINE
// needle2/needle3 use the same return convention: rc >= 0 success, rc < 0
// failure -> then (and only then) call needle_last_error().
static std::string engineLastErrorMessage() {
#if NEEDLE_ENGINE_GENERATION >= 3
    const char* detail = needle_last_error();
    if (detail && detail[0] != '\0') {
        return detail;
    }
#endif
    return "";
}

static std::string engineError(const char* what, int rc) {
    std::string detail = engineLastErrorMessage();
    if (detail.empty()) {
        detail = std::string(what) + " failed (code " + std::to_string(rc) + ")";
    } else {
        detail = std::string(what) + ": " + detail;
    }
    return detail;
}

// Read the whole .cact weights file. POSIX I/O instead of <fstream>, which has
// a history of awkward failure modes on older Android levels.
static bool readFileBytes(const char* path, std::vector<unsigned char>& out) {
    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        return false;
    }
    struct stat st;
    bool ok = fstat(fd, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0;
    if (ok) {
        out.resize(static_cast<size_t>(st.st_size));
        size_t offset = 0;
        while (offset < out.size()) {
            ssize_t n = read(fd, out.data() + offset, out.size() - offset);
            if (n <= 0) {
                ok = false;
                break;
            }
            offset += static_cast<size_t>(n);
        }
    } else {
        ok = false;
    }
    close(fd);
    if (!ok) {
        out.clear();
    }
    return ok;
}
#endif // HAVE_NEEDLE_ENGINE

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeInit(
    JNIEnv* env,
    jobject /* this */,
    jstring jWeightsPath,
    jint contextSize,
    jstring jSystemPrompt,
    jstring jToolIndexPath
) {
    if (!jWeightsPath) {
        LOGE("nativeInit: jWeightsPath is null");
        setLastError("weights path is null");
        return JNI_FALSE;
    }
    const char* weightsPath = env->GetStringUTFChars(jWeightsPath, nullptr);
    if (!weightsPath) {
        setLastError("weights path could not be decoded");
        return JNI_FALSE;
    }
    const char* systemPrompt = jSystemPrompt ? env->GetStringUTFChars(jSystemPrompt, nullptr) : nullptr;
    const char* toolIndexPath = jToolIndexPath ? env->GetStringUTFChars(jToolIndexPath, nullptr) : nullptr;
    LOGI("nativeInit weightsPath=%s contextSize=%d", weightsPath, contextSize);

    g_last_error.clear();

#if HAVE_NEEDLE_ENGINE
    // contextSize has no slot in needle_init(system_prompt, tools_json,
    // tool_index_path) - it is honored JS-side and logged for traceability.
    (void)contextSize;

    // Bridge contract (#291): needle_load -> needle_init -> ... -> needle_reset.
    // The weights are loaded first; the engine rejects any .cact whose
    // generation tag does not match the linked engine (needle_load < 0).
    std::vector<unsigned char> cact;
    if (!readFileBytes(weightsPath, cact)) {
        setLastError(std::string("cannot read weights file: ") + weightsPath);
        LOGE("%s", g_last_error.c_str());
        env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
        if (jSystemPrompt && systemPrompt) env->ReleaseStringUTFChars(jSystemPrompt, systemPrompt);
        if (jToolIndexPath && toolIndexPath) env->ReleaseStringUTFChars(jToolIndexPath, toolIndexPath);
        return JNI_FALSE;
    }

    int rc = needle_load(cact.data(), static_cast<unsigned long long>(cact.size()));
    if (rc < 0) {
        setLastError(engineError("needle_load", rc));
        LOGE("%s", g_last_error.c_str());
        env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
        if (jSystemPrompt && systemPrompt) env->ReleaseStringUTFChars(jSystemPrompt, systemPrompt);
        if (jToolIndexPath && toolIndexPath) env->ReleaseStringUTFChars(jToolIndexPath, toolIndexPath);
        return JNI_FALSE;
    }

    const char* sys = (systemPrompt && systemPrompt[0] != '\0') ? systemPrompt : "";
    // Statically-declared tools are baked into the engine's prefix at init time.
    // The app currently declares none at init (tools travel in the prompt);
    // wiring the app's tool schemas in here is ticket #277's scope.
    const char* tools = "[]";
    // tool_index_path is a documented upstream no-op on needle3.cact (no
    // contrastive head ships); the parameter is still wired through so behavior
    // does not change if upstream starts honouring it.
    const char* tip = (toolIndexPath && toolIndexPath[0] != '\0') ? toolIndexPath : nullptr;

    rc = needle_init(sys, tools, tip);
    if (rc < 0) {
        setLastError(engineError("needle_init", rc));
        LOGE("%s", g_last_error.c_str());
        env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
        if (jSystemPrompt && systemPrompt) env->ReleaseStringUTFChars(jSystemPrompt, systemPrompt);
        if (jToolIndexPath && toolIndexPath) env->ReleaseStringUTFChars(jToolIndexPath, toolIndexPath);
        return JNI_FALSE;
    }

    // rc >= 0: needle_init returns the tokenized static-prefix length (> 0 is
    // success too - the old `rc == 0` check misread it as failure).
    g_initialized = true;
    LOGI("needle engine ready (static prefix length %d)", rc);
    env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
    if (jSystemPrompt && systemPrompt) env->ReleaseStringUTFChars(jSystemPrompt, systemPrompt);
    if (jToolIndexPath && toolIndexPath) env->ReleaseStringUTFChars(jToolIndexPath, toolIndexPath);
    return JNI_TRUE;
#else
    LOGI("HAVE_NEEDLE_ENGINE is 0; initializing honest mock fallback engine");
    if (systemPrompt) { LOGI("mock system prompt: %s", systemPrompt); }
    if (toolIndexPath) { LOGI("mock tool_index_path: %s", toolIndexPath); }
    g_initialized = true;
    env->ReleaseStringUTFChars(jWeightsPath, weightsPath);
    if (jSystemPrompt && systemPrompt) env->ReleaseStringUTFChars(jSystemPrompt, systemPrompt);
    if (jToolIndexPath && toolIndexPath) env->ReleaseStringUTFChars(jToolIndexPath, toolIndexPath);
    return JNI_TRUE;
#endif
}

JNIEXPORT jstring JNICALL
Java_com_vela_client_needle_NeedleNative_nativeLastError(
    JNIEnv* env,
    jobject /* this */
) {
    if (g_last_error.empty()) {
        return nullptr;
    }
    return env->NewStringUTF(g_last_error.c_str());
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
        setLastError("engine not initialized");
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

#if HAVE_NEEDLE_ENGINE
    std::vector<char> outputBuffer(4096, 0);
    int rc = needle_complete(prompt, maxTokens, outputBuffer.data(), outputBuffer.size() - 1);
    env->ReleaseStringUTFChars(jPrompt, prompt);
    if (jToolsJson && toolsJson) env->ReleaseStringUTFChars(jToolsJson, toolsJson);

    if (rc >= 0) {
        return env->NewStringUTF(outputBuffer.data());
    }
    // rc < 0: the engine writes the failure detail into the output buffer
    // (mirrors upstream needle/__init__.py); fall back to needle_last_error().
    std::string detail(outputBuffer.data());
    if (detail.empty()) {
        detail = engineLastErrorMessage();
    }
    if (detail.empty()) {
        detail = "needle_complete failed (code " + std::to_string(rc) + ")";
    }
    setLastError(detail);
    LOGE("needle_complete failed: %s", detail.c_str());
    return env->NewStringUTF(("Error: " + detail).c_str());
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
    g_last_error.clear();
#if HAVE_NEEDLE_ENGINE
    // Upstream needle_reset() returns void - there is no status to inspect.
    needle_reset();
#endif
    return JNI_TRUE;
}

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeFree(
    JNIEnv* env,
    jobject /* this */
) {
    // Teardown: upstream dropped needle_free entirely (it is not in any
    // shipped archive - calling it would be a link error), so reset() is the
    // only available teardown and the engine stays loaded process-wide.
    g_initialized = false;
    g_last_error.clear();
#if HAVE_NEEDLE_ENGINE
    needle_reset();
#endif
    return JNI_TRUE;
}

JNIEXPORT jfloatArray JNICALL
Java_com_vela_client_needle_NeedleNative_nativeEmbed(
    JNIEnv* env,
    jobject /* this */,
    jstring jInput
) {
#if HAVE_NEEDLE_ENGINE && NEEDLE_ENGINE_GENERATION >= 3
    if (!g_initialized || !jInput) {
        LOGE("nativeEmbed: not initialized or input is null");
        return nullptr;
    }
    const char* input = env->GetStringUTFChars(jInput, nullptr);
    if (!input) {
        return nullptr;
    }
    // Probe with a null output first to size the embedding, mirroring
    // upstream needle/__init__.py. Feature wiring beyond this JNI method is
    // ticket #299's scope.
    int dim = needle_embed(input, nullptr, 0);
    if (dim <= 0) {
        setLastError(engineError("needle_embed", dim));
        LOGE("%s", g_last_error.c_str());
        env->ReleaseStringUTFChars(jInput, input);
        return nullptr;
    }
    std::vector<float> embedding(static_cast<size_t>(dim));
    int rc = needle_embed(input, embedding.data(), dim);
    env->ReleaseStringUTFChars(jInput, input);
    if (rc != dim) {
        setLastError(engineError("needle_embed", rc));
        LOGE("%s", g_last_error.c_str());
        return nullptr;
    }
    jfloatArray out = env->NewFloatArray(dim);
    if (!out) {
        return nullptr;
    }
    env->SetFloatArrayRegion(out, 0, dim, embedding.data());
    return out;
#else
    (void)jInput;
    LOGE("nativeEmbed: not available with this engine build");
    setLastError("embeddings require a Needle 3 engine");
    return nullptr;
#endif
}

JNIEXPORT jboolean JNICALL
Java_com_vela_client_needle_NeedleNative_nativeHasLibNeedle(
    JNIEnv* env,
    jobject /* this */
) {
#if HAVE_NEEDLE_ENGINE
    return JNI_TRUE;
#else
    return JNI_FALSE;
#endif
}

} // extern "C"
