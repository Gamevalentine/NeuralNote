// NOTIQ Stage 4: thin, offline CPU bridge around DamRsn/muscriptor.cpp.
// The bridge never downloads model weights, sends audio to a server, or logs audio.
#include <muscriptor/muscriptor.hpp>
#include "checkpoint.hpp"
#include "cpu_isa.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>
#include <chrono>

namespace {
constexpr std::size_t kMaxWaveBytes = 15 * 60 * 16000 * sizeof(float) + 4096;
constexpr std::uint32_t kSampleRate = 16000;
constexpr std::size_t kMaxSamples = 15 * 60 * kSampleRate;

std::uint16_t u16(const std::vector<std::uint8_t>& b, std::size_t p) {
    if (p > b.size() || b.size() - p < 2) throw std::runtime_error("Invalid WAV header");
    return static_cast<std::uint16_t>(b[p] | (b[p+1] << 8));
}
std::uint32_t u32(const std::vector<std::uint8_t>& b, std::size_t p) {
    if (p > b.size() || b.size() - p < 4) throw std::runtime_error("Invalid WAV header");
    return std::uint32_t(b[p]) | (std::uint32_t(b[p+1]) << 8) |
           (std::uint32_t(b[p+2]) << 16) | (std::uint32_t(b[p+3]) << 24);
}
bool fourcc(const std::vector<std::uint8_t>& b, std::size_t p, const char* id) {
    return p <= b.size() && b.size()-p >= 4
        && b[p] == static_cast<std::uint8_t>(id[0])
        && b[p+1] == static_cast<std::uint8_t>(id[1])
        && b[p+2] == static_cast<std::uint8_t>(id[2])
        && b[p+3] == static_cast<std::uint8_t>(id[3]);
}

std::vector<float> decodeWave(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary | std::ios::ate);
    if (!stream) throw std::runtime_error("Cannot open input WAV");
    const auto size = stream.tellg();
    if (size < 44 || size > static_cast<std::streamoff>(kMaxWaveBytes))
        throw std::runtime_error("Input WAV too large or invalid (15 minutes maximum)");
    stream.seekg(0);
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
    if (!stream.read(reinterpret_cast<char*>(bytes.data()), size))
        throw std::runtime_error("Cannot read WAV input");

    if (!fourcc(bytes,0,"RIFF") || !fourcc(bytes,8,"WAVE") || u32(bytes,4) > bytes.size()-8)
        throw std::runtime_error("Expected RIFF/WAVE");
    bool fmtSeen=false, dataSeen=false;
    std::size_t dataBegin=0, dataSize=0;
    for (std::size_t p=12; p+8 <= bytes.size();) {
        auto chunkSize = static_cast<std::size_t>(u32(bytes,p+4));
        auto payload=p+8;
        if (chunkSize > bytes.size()-payload) throw std::runtime_error("Truncated WAV chunk");
        if (fourcc(bytes,p,"fmt ")) {
            if (chunkSize < 16 || u16(bytes,payload)!=3 || u16(bytes,payload+2)!=1 ||
                u32(bytes,payload+4)!=kSampleRate || u16(bytes,payload+14)!=32 ||
                u16(bytes,payload+12)!=4)
                throw std::runtime_error("WAV must be IEEE float32, mono, 16kHz");
            fmtSeen=true;
        } else if (fourcc(bytes,p,"data")) {
            dataBegin=payload;
            dataSize=chunkSize;
            dataSeen=true;
        }
        p=payload+chunkSize+(chunkSize%2);
    }
    if (!fmtSeen || !dataSeen || dataSize==0 || dataSize%4 != 0 ||
        dataSize/4>kMaxSamples) throw std::runtime_error("Invalid WAV audio data");
    std::vector<float> result(dataSize/4);
    for(std::size_t i=0;i<result.size();++i){
        const float value=std::bit_cast<float>(u32(bytes,dataBegin+i*4));
        if (!std::isfinite(value) || value < -1.01f || value > 1.01f)
            throw std::runtime_error("Invalid WAV sample");
        result[i]=value;
    }
    return result;
}

void writeJson(const std::filesystem::path& path, const std::vector<msl::Note>& notes) {
    // Atomic rename so Electron never observes a half-written MIDI result.
    auto partial=path;
    partial += ".partial";
    std::ofstream out(partial, std::ios::binary | std::ios::trunc);
    if(!out) throw std::runtime_error("Cannot open output JSON");
    out << "{\"schema\":1,\"engine\":\"muscriptor\",\"notes\":[";
    out << std::setprecision(10);
    bool first=true;
    for (const auto& note : notes) {
        if(!std::isfinite(note.onset) || !std::isfinite(note.offset) ||
           note.onset < 0 || note.offset <= note.onset ||
           note.pitch < 0 || note.pitch > 127 ||
           note.program < 0 || note.program > 128)
            continue;
        if(!first) out << ',';
        first=false;
        out << "{\"startTimeSeconds\":" << note.onset
            << ",\"durationSeconds\":" << note.offset-note.onset
            << ",\"pitchMidi\":" << note.pitch
            << ",\"program\":" << note.program
            << ",\"isDrum\":" << (note.is_drum?"true":"false")
            << ",\"amplitude\":0.7874015748}";
    }
    out << "]}";
    out.close();
    if(!out) throw std::runtime_error("Cannot flush output JSON");
    std::error_code ec;
    std::filesystem::remove(path,ec);
    std::filesystem::rename(partial,path,ec);
    if(ec) throw std::runtime_error("Cannot finalize JSON result");
}

int run(const std::vector<std::filesystem::path>& args) {
    if(args.size()==1 && args[0]==std::filesystem::path("--cpu-isa")){
        std::cout << "{\"experimental_avx2_build\":"
                  << (notiq_cpu_isa::kAvx2DiagnosticBuild?"true":"false")
                  << ",\"host_avx2_fma_bmi2\":"
                  << (notiq_cpu_isa::supports_avx2_fma_bmi2()?"true":"false")
                  << "}\n";
        return 0;
    }
    if(args.size()==1 && args[0]==std::filesystem::path("--capabilities")){
        std::cout << "{\"bridge\":\"notiq-muscriptor\",\"schema\":1,\"cpu_threads\":[2,4,6],\"default_threads\":2,\"resume_checkpoint\":true}\n";
        return 0;
    }
    if(args.size()==1 && args[0]==std::filesystem::path("--version")){
        std::cout << "NOTIQ MuScriptor bridge protocol=1 audio=float32-mono-16000\n";
        return 0;
    }
    if(args.size()==1 && args[0]==std::filesystem::path("--self-test-checkpoint")){
        const auto file=std::filesystem::temp_directory_path()/
          ("notiq-5mc-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count())+".cp");
        try{
            notiq_checkpoint::State state;
            state.resume="muscriptor-resume 1\nsamples 80000\n";
            msl::Note note;
            note.onset=0.1;note.offset=1.25;note.pitch=60;note.program=0;note.is_drum=false;
            state.notes.push_back(note);
            notiq_checkpoint::save(file,state,80000,123456ULL,2);
            auto restored=notiq_checkpoint::load(file,80000,123456ULL,2);
            if(restored.notes.size()!=1 || restored.notes[0].offset!=1.25 ||
               restored.resume!=state.resume)throw std::runtime_error("Checkpoint roundtrip failed");
            bool mismatchRejected=false;
            try{(void)notiq_checkpoint::load(file,80000,999ULL,2);}
            catch(const std::exception&){mismatchRejected=true;}
            std::filesystem::remove(file);
            if(!mismatchRejected)throw std::runtime_error("Mismatched WAV checkpoint accepted");
            std::cout<<"NOTIQ_5MC_CHECKPOINT_SELF_TEST_PASS\n";return 0;
        }catch(...){std::error_code ec;std::filesystem::remove(file,ec);throw;}
    }
    if(args.size()==1 && args[0]==std::filesystem::path("--self-test")){
        // Does not load weights. Exercising the sample parser and library linkage happens
        // separately in CI. This switch confirms this executable actually starts.
        std::cout << "{\"bridge\":\"notiq-muscriptor\",\"schema\":1,\"ready\":true}\n";
        return 0;
    }
    if(args.size()==2 && args[0]==std::filesystem::path("--probe-wav")){
        const auto audio = decodeWave(args[1]);
        std::cout << "OK samples=" << audio.size()
                  << " seconds=" << (static_cast<double>(audio.size())/kSampleRate) << '\n';
        return 0;
    }
    if(args.size()<3 || args.size()>6){
        std::cerr << "Usage: notiq-muscriptor-cli <16k-f32-mono.wav> <model.gguf> <result.json>\n";
        return 2;
    }
    int requestedThreads=2;
    bool emitTiming=false;
    std::filesystem::path checkpointPath;
    for(std::size_t arg=3;arg<args.size();++arg){
        const auto wide=args[arg].wstring();
        const auto setting=args[arg].string();
        if(setting=="--timing" && !emitTiming)emitTiming=true;
        else if(setting=="--threads=2")requestedThreads=2;
        else if(setting=="--threads=4")requestedThreads=4;
        else if(setting=="--threads=6")requestedThreads=6;
        else if(wide.rfind(L"--checkpoint=",0)==0 && checkpointPath.empty() && wide.size()>13)
            checkpointPath=wide.substr(13);
        else throw std::runtime_error("Invalid CLI argument; only --threads=2,4,6, --checkpoint=<path> and --timing");
    }
    // The diagnostic AVX2 build is deliberately NOT safe on all Windows PCs.
    // Reject unsupported CPU/OS state before model load / any ggml compute.
    // Original baseline build is unaffected and remains the release default.
    if(notiq_cpu_isa::kAvx2DiagnosticBuild &&
       !notiq_cpu_isa::supports_avx2_fma_bmi2())
        throw std::runtime_error(
            "AVX2 diagnostic binary requires AVX2, FMA, BMI2 and OS YMM support. Use original NOTIQ baseline.");
    if(!std::filesystem::is_regular_file(args[1]))
        throw std::runtime_error("MuScriptor model missing; download an approved GGUF first");
    auto audio=decodeWave(args[0]);
    std::cerr << "PROGRESS 3\n";
    const auto loadStartedAt=std::chrono::steady_clock::now();
    msl::LoadOptions loadOptions {};
    // Empty device = Auto; CPU-only library means this resolves to CPU.
    loadOptions.on_progress=[](float fraction){
        auto pct=3+static_cast<int>(fraction*17);
        std::cerr << "PROGRESS " << std::clamp(pct,3,20) << '\n';
    };
    auto engine=msl::Transcriber::load(args[1],std::move(loadOptions));
    if(!engine) throw std::runtime_error(std::string("MuScriptor could not load weights: ")+msl::describe(engine.error()));
    std::cerr << "PROGRESS 20\n";
    if(emitTiming){
        const auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now()-loadStartedAt).count();
        std::cerr << "NOTIQ_TIMING_LOAD_WALL_MS " << elapsed << '\n';
    }
    msl::TranscribeOptions options {};
    options.n_threads=requestedThreads;
    const bool resumable=!checkpointPath.empty();
    const auto audioFingerprint=resumable?notiq_checkpoint::audioHash(audio):0ULL;
    notiq_checkpoint::State completed;
    if(resumable){
        completed=notiq_checkpoint::load(checkpointPath,audio.size(),audioFingerprint,requestedThreads);
        if(!completed.resume.empty()){
            options.resume_from=completed.resume;
            std::cerr<<"NOTIQ_RESUMED_NOTES "<<completed.notes.size()<<"\n";
        }
    }
    auto lastChunkAt=std::chrono::steady_clock::now();
    std::size_t updatesMeasured=0;
    auto onUpdate=[&](const msl::TranscriptionUpdate& update){
        if(emitTiming){
            const auto now=std::chrono::steady_clock::now();
            const auto ms=std::chrono::duration_cast<std::chrono::milliseconds>(
                now-lastChunkAt).count();
            lastChunkAt=now;
            std::cerr << "NOTIQ_TIMING_UPDATE " << ++updatesMeasured
                      << " wall_ms=" << ms
                      << " finalized_through_s=" << update.finalized_through << '\n';
        }
        if(resumable){
            // The original model releases notes one 5-second chunk late.
            // This preserves cross-boundary continuity without re-decoding
            // overlaps or adding duplicate notes.
            completed.notes.insert(completed.notes.end(),update.new_notes.begin(),update.new_notes.end());
            if(!update.resume_point.empty()){
                completed.resume=update.resume_point;
                notiq_checkpoint::save(checkpointPath,completed,audio.size(),
                                       audioFingerprint,requestedThreads);
            }
            std::cerr<<"NOTIQ_CHECKPOINT "<<completed.notes.size()<<' '<<
                std::fixed<<std::setprecision(2)<<update.finalized_through<<"\n";
        }
        std::cerr<<"PROGRESS "<<std::clamp(20+static_cast<int>(update.progress*78),20,98)<<"\n";
        return true;
    };
    auto result=engine->transcribe(std::span<const float>(audio),options,onUpdate);
    if(!result)throw std::runtime_error(std::string("MuScriptor transcription failed: ")+msl::describe(result.error()));
    if(resumable){
        writeJson(args[2],completed.notes);
        std::error_code ec;std::filesystem::remove(checkpointPath,ec);
    }else writeJson(args[2],*result);
    std::cerr<<"PROGRESS 100\n";
    std::cout<<"OK notes="<<(resumable?completed.notes.size():result->size())<<'\n';
    return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t* argv[]){
    try {
        std::vector<std::filesystem::path> args;
        for(int i=1;i<argc;++i) args.emplace_back(argv[i]);
        return run(args);
    } catch(const std::exception& err) {
        std::cerr << "ERROR " << err.what() << '\n';
        return 1;
    }
}
#else
int main(int argc,char* argv[]){
    try {
        std::vector<std::filesystem::path> args;
        for(int i=1;i<argc;++i) args.emplace_back(argv[i]);
        return run(args);
    } catch(const std::exception& err) {
        std::cerr << "ERROR " << err.what() << '\n';
        return 1;
    }
}
#endif
