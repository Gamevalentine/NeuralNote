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
add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/../ThirdParty/muscriptor.cpp/cpp"
                 "${CMAKE_CURRENT_BINARY_DIR}/muscriptor")

add_executable(notiq-muscriptor-cli main.cpp)
target_link_libraries(notiq-muscriptor-cli PRIVATE muscriptor_ggml)
target_compile_features(notiq-muscriptor-cli PRIVATE cxx_std_23)

# Keep executable discoverable for the Electron Windows preview packaging step.
if(WIN32)
  set_target_properties(notiq-muscriptor-cli PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/native-bin")
endif()
