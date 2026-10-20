#!/usr/bin/env bash
# Called by GitHub Codespaces automatically. No terminal commands from the user.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends cmake ninja-build g++ pkg-config ca-certificates git
git submodule update --init ThirdParty/muscriptor.cpp
cmake -S notiq-native -B .notiq-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DMUSCRIPTOR_VULKAN=OFF -DMUSCRIPTOR_METAL=OFF -DMUSCRIPTOR_BUILD_TESTS=OFF
cmake --build .notiq-build --target notiq-muscriptor-cli -j 2
(cd web && npm install --no-audit --no-fund && npm run build && npm run test:long && npm run test:daw && npm run test:piano && npm run test:soundfont)
(cd web && node --experimental-strip-types --test tests/neuralnote-core-routing.test.mts tests/muscriptor-protocol.test.mts)
(cd notiq-api && npm test)
echo "NOTIQ: source build and API tests finished. See PORTS tab > NOTIQ Web."
