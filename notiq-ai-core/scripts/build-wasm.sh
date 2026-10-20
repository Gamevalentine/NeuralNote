#!/usr/bin/env bash
# Experimental compile, not a production release or an AI demo.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULE="$ROOT/notiq-ai-core"
if ! command -v emcmake >/dev/null 2>&1; then
  echo "Emscripten/emcmake is not installed in this build environment." >&2
  exit 2
fi
if [ ! -f "$MODULE/vendor/muscriptor/cpp/CMakeLists.txt" ]; then
  python3 "$MODULE/scripts/snapshot_source.py"
fi
emcmake cmake -S "$MODULE" -B "$MODULE/.build-wasm" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="-O2 -msimd128" \
  -DCMAKE_CXX_FLAGS="-O2 -msimd128 -fexceptions" \
  -DMUSCRIPTOR_VULKAN=OFF -DMUSCRIPTOR_METAL=OFF \
  -DMUSCRIPTOR_BUILD_TESTS=OFF -DMUSCRIPTOR_BUILD_BENCH=OFF
cmake --build "$MODULE/.build-wasm" --target notiq_ai_core -j 2
echo "Compiled WASM; recognition with the real GGUF model is NOT yet tested."
