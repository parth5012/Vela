cmake_minimum_required(VERSION 3.22.1)
project(needle_native)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_library(LOG_LIB log)

# Check for prebuilt libneedle.so in src/main/jniLibs/${ANDROID_ABI}
set(NEEDLE_SO_PATH "${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libneedle.so")

if(EXISTS "${NEEDLE_SO_PATH}")
    message(STATUS "Found libneedle.so for ${ANDROID_ABI} at ${NEEDLE_SO_PATH}")
    add_library(needle_prebuilt SHARED IMPORTED)
    set_target_properties(needle_prebuilt PROPERTIES
        IMPORTED_LOCATION "${NEEDLE_SO_PATH}"
    )
    set(HAVE_NEEDLE_SO 1)
else()
    message(STATUS "libneedle.so not found for ${ANDROID_ABI} - building with mock fallback stub")
    set(HAVE_NEEDLE_SO 0)
endif()

add_library(needle SHARED
    src/main/cpp/needle-jni.cpp
)

target_compile_definitions(needle PRIVATE
    HAVE_NEEDLE_SO=${HAVE_NEEDLE_SO}
)

target_include_directories(needle PRIVATE
    src/main/cpp
)

if(HAVE_NEEDLE_SO)
    target_link_libraries(needle
        needle_prebuilt
        ${LOG_LIB}
    )
else()
    target_link_libraries(needle
        ${LOG_LIB}
    )
endif()
