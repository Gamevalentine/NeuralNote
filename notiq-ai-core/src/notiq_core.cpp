// NOTIQ AI Core — NOTIQ-specific adapter around the MIT-licensed
// MuScriptor implementation already checked out with this repository.
// This is the real inference API. No pitch heuristic, demo notes or server call.
#include <muscriptor/muscriptor.hpp>
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <iomanip>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <span>
#include <string>
#include <utility>

// Emscripten calls this from inside MuScriptor's actual model-load/chunk
// callbacks. UI updates therefore reflect REAL progress instead of a timer.
EM_JS(void, notiq_emit_progress, (int value), {
    if (typeof postMessage === 'function') {
        postMessage({ type: 'progress', percent: value });
    }
});

namespace {
std::optional<msl::Transcriber> engine;
std::string lastError;
std::string lastResult;
int percent = 0;
constexpr std::size_t kMaxSamples = 15ULL * 60 * 16000;
constexpr std::size_t kMaxNotes = 150000;

void fail(std::string message) {
    lastError = std::move(message);
    lastResult.clear();
}

std::string serialize(const std::vector<msl::Note>& notes) {
    if (notes.size() > kMaxNotes) throw std::runtime_error("Too many note events");
    std::ostringstream stream;
    stream << std::setprecision(10);
    stream << R"({"schema":1,"engine":"muscriptor","notes":[)";
    bool first = true;
    for (const auto& note : notes) {
        if (!std::isfinite(note.onset) || !std::isfinite(note.offset) ||
            note.onset < 0 || note.offset <= note.onset ||
            note.pitch < 0 || note.pitch > 127 ||
            note.program < 0 || note.program > 128) continue;
        if (!first) stream << ',';
        first = false;
        stream << R"({"startTimeSeconds":)" << note.onset
               << R"(,"durationSeconds":)" << note.offset - note.onset
               << R"(,"pitchMidi":)" << note.pitch
               << R"(,"program":)" << note.program
               << R"(,"isDrum":)" << (note.is_drum ? "true" : "false")
               << R"(,"amplitude":0.7874015748})";
    }
    stream << "]}";
    return stream.str();
}
}

extern "C" {

// The browser worker writes the user-provided GGUF to the WASM virtual FS
// before calling this function. No model URL/token is baked into NOTIQ.
EMSCRIPTEN_KEEPALIVE int notiq_core_load_model(const char* modelPath) {
    engine.reset();
    lastError.clear();
    lastResult.clear();
    percent = 0;
    if (!modelPath || !modelPath[0]) {
        fail("Missing MuScriptor GGUF model path");
        return 0;
    }
    try {
        msl::LoadOptions options{};
        options.on_progress = [](float fraction) {
            percent = std::clamp(static_cast<int>(fraction * 15), 0, 15);
            notiq_emit_progress(percent);
        };
        auto loaded = msl::Transcriber::load(modelPath, std::move(options));
        if (!loaded) {
            fail("MuScriptor: " + msl::describe(loaded.error()));
            return 0;
        }
        engine.emplace(std::move(*loaded));
        percent = 15;
        notiq_emit_progress(percent);
        return 1;
    } catch (const std::exception& error) {
        fail(error.what());
        return 0;
    }
}

// Audio must be full-length, 16kHz, mono float32, normalized to [-1, 1].
// Inference is synchronous; caller MUST invoke it in a dedicated Web Worker.
EMSCRIPTEN_KEEPALIVE int notiq_core_transcribe(const float* samples, int sampleCount) {
    lastError.clear();
    lastResult.clear();
    if (!engine) {
        fail("Load the real GGUF model before transcription");
        return 0;
    }
    if (!samples || sampleCount <= 0 ||
        static_cast<std::size_t>(sampleCount) > kMaxSamples) {
        fail("Audio must be 16kHz mono and no longer than 15 minutes");
        return 0;
    }
    for (int i = 0; i < sampleCount; ++i) {
        if (!std::isfinite(samples[i]) || std::abs(samples[i]) > 1.01f) {
            fail("Invalid sample data");
            return 0;
        }
    }
    percent = 15;
    try {
        msl::TranscribeOptions options{};
        options.n_threads = 1; // First WASM proof: no SharedArrayBuffer/pthreads.
        auto recognized = engine->transcribe(
            std::span<const float>(samples, static_cast<std::size_t>(sampleCount)),
            options,
            [](const msl::TranscriptionUpdate& update) {
                percent = std::clamp(15 + static_cast<int>(update.progress * 84), 15, 99);
                notiq_emit_progress(percent);
                return true;
            });
        if (!recognized) {
            fail("MuScriptor: " + msl::describe(recognized.error()));
            return 0;
        }
        lastResult = serialize(*recognized);
        percent = 100;
        notiq_emit_progress(percent);
        return 1;
    } catch (const std::exception& error) {
        fail(error.what());
        return 0;
    }
}

EMSCRIPTEN_KEEPALIVE int notiq_core_progress() { return percent; }
EMSCRIPTEN_KEEPALIVE const char* notiq_core_error() { return lastError.c_str(); }
EMSCRIPTEN_KEEPALIVE const char* notiq_core_result_json() { return lastResult.c_str(); }
EMSCRIPTEN_KEEPALIVE void notiq_core_unload() {
    engine.reset();
    lastResult.clear();
    lastError.clear();
    percent = 0;
}
}
