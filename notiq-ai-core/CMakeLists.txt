cmake_minimum_required(VERSION 3.24)
project(notiq_ai_core LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "NOTIQ AI Core WebAssembly build requires Emscripten.")
endif()
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_BUILD_BENCH OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_VULKAN OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_METAL OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
# The pinned ggml version has a dedicated wasm32 CPU backend; avoid native
# x86 variants. We need a separate .wasm file for the module Worker.
set(GGML_WASM_SINGLE_FILE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)

if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/vendor/muscriptor/cpp/CMakeLists.txt")
  message(FATAL_ERROR "NOTIQ source snapshot missing. Run scripts/snapshot_source.py first.")
endif()
add_subdirectory(vendor/muscriptor/cpp vendor-build)
# PFFFT vends a NEON branch when __wasm_simd128__ is defined, but wasm32
# cannot include <arm_neon.h>. Use PFFFT's existing scalar FFT on this
# Emscripten-only target; upstream/native MuScriptor is unchanged.
if(EMSCRIPTEN)
  target_compile_definitions(pffft PRIVATE PFFFT_SIMD_DISABLE=1)
endif()
add_executable(notiq_ai_core src/notiq_core.cpp)
target_link_libraries(notiq_ai_core PRIVATE muscriptor_ggml)
target_compile_options(notiq_ai_core PRIVATE -O2 -msimd128 -fexceptions)
target_link_options(notiq_ai_core PRIVATE
  -O2 -msimd128 -fexceptions
  "SHELL:-sMODULARIZE=1"
  "SHELL:-sEXPORT_ES6=1"
  "SHELL:-sENVIRONMENT=web,worker"
  "SHELL:-sALLOW_MEMORY_GROWTH=1"
  "SHELL:-sMAXIMUM_MEMORY=2147483648"
  "SHELL:-sINITIAL_MEMORY=268435456"
  "SHELL:-sSTACK_SIZE=8388608"
  "SHELL:-sASSERTIONS=1"
  "SHELL:-sFILESYSTEM=1"
  "SHELL:-sEXPORTED_FUNCTIONS=['_malloc','_free','_notiq_core_load_model','_notiq_core_transcribe','_notiq_core_progress','_notiq_core_error','_notiq_core_result_json','_notiq_core_unload']"
  "SHELL:-sEXPORTED_RUNTIME_METHODS=['FS','UTF8ToString','stringToUTF8','lengthBytesUTF8']"
)
set_target_properties(notiq_ai_core PROPERTIES OUTPUT_NAME "notiq-ai-core" SUFFIX ".js")
