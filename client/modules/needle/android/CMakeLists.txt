cmake_minimum_required(VERSION 3.22.1)
project(needle_native)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_library(LOG_LIB log)

# --- Needle engine selection -------------------------------------------------
# Upstream (Cactus Compute) ships only STATIC per-ABI `libneedle.a` archives;
# there is no prebuilt `libneedle.so`, so the archive is fetched at configure
# time into the gitignored engine/ directory and linked into OUR JNI .so.
#
# needle2 and needle3 are TWO DIFFERENT static archives that export the SAME
# `needle_*` symbols (needle_init/complete/reset/load), so exactly one of them
# can be linked into this single shared library - a runtime model switch would
# require separate link units (upstream itself ships libneedle2/libneedle3 as
# separate CDLLs; deferred, see docs/decisions.md). Select at configure time:
#   ./gradlew ... or -DNEEDLE_ENGINE_MODEL=needle2
set(NEEDLE_ENGINE_MODEL "needle3" CACHE STRING "Static needle engine to link (needle3|needle2)")
set_property(CACHE NEEDLE_ENGINE_MODEL PROPERTY STRINGS needle3 needle2)

if(NEEDLE_ENGINE_MODEL STREQUAL "needle3")
    set(NEEDLE_ENGINE_GENERATION 3)
elseif(NEEDLE_ENGINE_MODEL STREQUAL "needle2")
    set(NEEDLE_ENGINE_GENERATION 2)
else()
    message(FATAL_ERROR "NEEDLE_ENGINE_MODEL must be 'needle3' or 'needle2' (got '${NEEDLE_ENGINE_MODEL}')")
endif()

option(NEEDLE_FETCH "Download the pinned needle engine archive at configure time when missing (OFF = verify cache only, never network)" ON)

# Upstream folder per Android ABI. ABIs without an upstream archive (e.g.
# x86_64 emulators) simply build the honest mock fallback.
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(NEEDLE_ENGINE_UPSTREAM_ABI "android-arm64")
elseif(ANDROID_ABI STREQUAL "armeabi-v7a")
    set(NEEDLE_ENGINE_UPSTREAM_ABI "android-armv7")
elseif(ANDROID_ABI STREQUAL "riscv64")
    set(NEEDLE_ENGINE_UPSTREAM_ABI "android-riscv64")
else()
    set(NEEDLE_ENGINE_UPSTREAM_ABI "")
endif()

set(NEEDLE_ENGINE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/engine/${NEEDLE_ENGINE_MODEL}/${ANDROID_ABI}")
set(NEEDLE_ENGINE_LIB "${NEEDLE_ENGINE_DIR}/libneedle.a")
set(NEEDLE_FETCH_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/fetch-engine.js")
set(NEEDLE_FETCH_LOCK "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/engine.lock.json")

# Re-run configure whenever the pinned lock changes, so a re-pin re-verifies
# the archive on the next build (review S2).
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${NEEDLE_FETCH_LOCK}")

# Verify-on-configure (review S2): the NOT EXISTS short-cut is gone — the
# script runs whenever an upstream archive exists for this ABI, hash-checking
# the cache (a few ms) and only downloading when the file is missing or does
# not match its pin, so a corrupted/stale archive is re-verified or repaired
# instead of being linked blindly. NEEDLE_FETCH=OFF runs it in --offline mode
# (verify-only, never network).
#
# Fail closed to the honest mock: HAVE_NEEDLE_ENGINE is set to 1 only when
# fetch-engine.js just verified this exact archive against engine.lock.json.
# Verification failure (corrupt file, pin mismatch, network miss) or no node
# to run it means the archive cannot be trusted — never link it unverified;
# the build proceeds with the mock fallback and says so.
set(HAVE_NEEDLE_ENGINE 0)
if(NEEDLE_ENGINE_UPSTREAM_ABI)
    find_program(NEEDLE_NODE_EXECUTABLE NAMES node nodejs)
    if(NEEDLE_NODE_EXECUTABLE)
        set(NEEDLE_FETCH_ARGS
            --lock "${NEEDLE_FETCH_LOCK}"
            --model "${NEEDLE_ENGINE_MODEL}"
            --abi "${ANDROID_ABI}"
        )
        if(NOT NEEDLE_FETCH)
            list(APPEND NEEDLE_FETCH_ARGS --offline)
        endif()
        message(STATUS "Verifying needle engine archive for ${ANDROID_ABI} via fetch-engine.js")
        execute_process(
            COMMAND "${NEEDLE_NODE_EXECUTABLE}" "${NEEDLE_FETCH_SCRIPT}" ${NEEDLE_FETCH_ARGS}
            WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
            RESULT_VARIABLE NEEDLE_FETCH_RESULT
            OUTPUT_VARIABLE NEEDLE_FETCH_OUTPUT
            ERROR_VARIABLE NEEDLE_FETCH_ERROR
        )
        if(NEEDLE_FETCH_RESULT EQUAL 0 AND EXISTS "${NEEDLE_ENGINE_LIB}")
            set(HAVE_NEEDLE_ENGINE 1)
            message(STATUS "Needle engine archive verified: ${NEEDLE_ENGINE_LIB}")
        else()
            message(STATUS "Needle engine verification/fetch failed (exit ${NEEDLE_FETCH_RESULT}): ${NEEDLE_FETCH_OUTPUT}${NEEDLE_FETCH_ERROR}")
            message(STATUS "Building with the honest mock fallback (engine archive missing or unverified)")
        endif()
    else()
        message(STATUS "node not found - cannot verify the needle engine archive; building with honest mock fallback (never linking an unverified archive)")
    endif()
else()
    message(STATUS "No upstream needle engine archive for ABI ${ANDROID_ABI} (${NEEDLE_ENGINE_MODEL}) - building with honest mock fallback stub")
endif()

# Engine verified above -> static link; otherwise the honest mock fallback.
if(HAVE_NEEDLE_ENGINE)
    message(STATUS "Linking needle engine (${NEEDLE_ENGINE_MODEL}, gen ${NEEDLE_ENGINE_GENERATION}) for ${ANDROID_ABI} from ${NEEDLE_ENGINE_LIB}")
    add_library(needle_engine STATIC IMPORTED)
    set_target_properties(needle_engine PROPERTIES
        IMPORTED_LOCATION "${NEEDLE_ENGINE_LIB}"
    )
endif()

add_library(needle SHARED
    src/main/cpp/needle-jni.cpp
)

target_compile_definitions(needle PRIVATE
    HAVE_NEEDLE_ENGINE=${HAVE_NEEDLE_ENGINE}
    NEEDLE_ENGINE_GENERATION=${NEEDLE_ENGINE_GENERATION}
)

target_include_directories(needle PRIVATE
    src/main/cpp
)

if(HAVE_NEEDLE_ENGINE)
    target_link_libraries(needle
        needle_engine
        ${LOG_LIB}
    )
else()
    target_link_libraries(needle
        ${LOG_LIB}
    )
endif()
