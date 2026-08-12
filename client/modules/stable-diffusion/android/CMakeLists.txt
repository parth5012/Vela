cmake_minimum_required(VERSION 3.22.1)
project(stable_diffusion_native)

# Configure compiler flags
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find Vulkan library for Android GPU acceleration
find_library(VULKAN_LIB vulkan)
find_library(LOG_LIB log)
find_library(ANDROIDSYSTEM_LIB android)

# Define our JNI wrapper source
add_library(stable-diffusion SHARED
    src/main/cpp/stable-diffusion-jni.cpp
    src/main/cpp/stable-diffusion.cpp
    src/main/cpp/ggml.c
    src/main/cpp/ggml-alloc.c
    src/main/cpp/ggml-backend.c
    src/main/cpp/ggml-quants.c
    src/main/cpp/ggml-vulkan.cpp
)

target_include_directories(stable-diffusion PRIVATE
    src/main/cpp
)

target_link_libraries(stable-diffusion
    ${VULKAN_LIB}
    ${LOG_LIB}
    ${ANDROIDSYSTEM_LIB}
)
