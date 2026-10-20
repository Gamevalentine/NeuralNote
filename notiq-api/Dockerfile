# Preview only: actual C++ MuScriptor + a minimal authenticated Node API.
# Build context must be repository root. Validate submodule revision before deployment.
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build g++ git ca-certificates pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY notiq-native/ /src/notiq-native/
COPY .gitmodules /src/.gitmodules
# The Docker provider may not fetch git submodules from the selected branch.
# A specific git commit can be supplied via MUSCRIPTOR_COMMIT at build time.
ARG MUSCRIPTOR_COMMIT
RUN test -n "$MUSCRIPTOR_COMMIT" || (echo "Set pinned MUSCRIPTOR_COMMIT from the NeuralNote gitlink" >&2; exit 1)
RUN mkdir -p /src/ThirdParty && git clone https://github.com/DamRsn/muscriptor.cpp.git /src/ThirdParty/muscriptor.cpp && \
    git -C /src/ThirdParty/muscriptor.cpp checkout "$MUSCRIPTOR_COMMIT"
RUN cmake -S notiq-native -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release -DMUSCRIPTOR_VULKAN=OFF -DMUSCRIPTOR_METAL=OFF && cmake --build /build --target notiq-muscriptor-cli -j 2

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/native-bin/notiq-muscriptor-cli /usr/local/bin/notiq-muscriptor-cli
COPY notiq-api/ /app/
ENV NOTIQ_CLI_PATH=/usr/local/bin/notiq-muscriptor-cli
ENV NOTIQ_MODEL_PATH=/app/models/muscriptor-small-f16.gguf
ENV PORT=8080
EXPOSE 8080
CMD ["node", "/app/bootstrap.mjs"]
