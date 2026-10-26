cmake_minimum_required(VERSION 3.24)
project(notiq_muscriptor_bridge LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_VULKAN OFF CACHE BOOL "Build native bridge CPU-only" FORCE)
set(MUSCRIPTOR_METAL OFF CACHE BOOL "" FORCE)
if (MSVC)
  add_compile_options(/utf-8)
endif ()

# Reuse the exact checked-out muscriptor.cpp submodule used by the original NOTIQ
# engine; no duplicate ML implementation and no new model license.
if (NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/../ThirdParty/muscriptor.cpp/cpp/CMakeLists.txt")
  message(FATAL_ERROR "Required recursive muscriptor.cpp submodule is absent")
endif ()
# Two isolated build modes:
# OFF = EXACT original pinned source and its safe pre-AVX2 x86 baseline.
# ON  = locally vendored source from the IDENTICAL pinned upstream revision,
#       with AVX2/FMA/BMI2 turned on, for internal comparative diagnostics.
# The modified vendor must NOT replace the original release dependency.
option(NOTIQ_ENABLE_AVX2_DIAGNOSTIC
       "INTERNAL WINDOWS QA ONLY: build AVX2/BMI2/FMA MuScriptor" OFF)
if(NOTIQ_ENABLE_AVX2_DIAGNOSTIC)
    if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
        message(FATAL_ERROR "AVX2 diagnostic variant requires Windows MSVC x64")
    endif()
    set(NOTIQ_EXPERIMENTAL_AVX2 ON CACHE BOOL "" FORCE)
    set(NOTIQ_MUSCRIPTOR_SOURCE
        "${CMAKE_CURRENT_LIST_DIR}/../notiq-ai-core/vendor/muscriptor/cpp")
    if(NOT EXISTS "${NOTIQ_MUSCRIPTOR_SOURCE}/CMakeLists.txt")
        message(FATAL_ERROR "Pinned, license-preserving MuScriptor vendor missing")
    endif()
    message(STATUS "NOTIQ: EXPERIMENTAL AVX2 variant, not for broad deployment")
else()
    set(NOTIQ_MUSCRIPTOR_SOURCE
        "${CMAKE_CURRENT_LIST_DIR}/../ThirdParty/muscriptor.cpp/cpp")
endif()
add_subdirectory("${NOTIQ_MUSCRIPTOR_SOURCE}"
                 "${CMAKE_CURRENT_BINARY_DIR}/muscriptor")

add_executable(notiq-muscriptor-cli main.cpp)
target_link_libraries(notiq-muscriptor-cli PRIVATE muscriptor_ggml)
target_compile_features(notiq-muscriptor-cli PRIVATE cxx_std_23)
if(NOTIQ_ENABLE_AVX2_DIAGNOSTIC)
  target_compile_definitions(notiq-muscriptor-cli PRIVATE NOTIQ_EXPERIMENTAL_AVX2=1)
endif()

# Keep executable discoverable for the Electron Windows preview packaging step.
if(WIN32)
  set_target_properties(notiq-muscriptor-cli PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/native-bin")
endif()
