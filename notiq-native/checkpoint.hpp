#pragma once
// NOTIQ 5M-C: atomic, local resume checkpoint. No GGUF/audio or passwords stored.
#include <muscriptor/note.hpp>
#include <bit>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace notiq_checkpoint {
struct State {
    std::string resume;
    std::vector<msl::Note> notes;
};
inline std::uint64_t audioHash(const std::vector<float>& samples) {
    std::uint64_t h=14695981039346656037ULL;
    for(float v:samples){
        auto b=std::bit_cast<std::uint32_t>(v);
        for(int k=0;k<4;++k){h^=(b>>(k*8))&255U;h*=1099511628211ULL;}
    }
    return h;
}
inline bool validNote(const msl::Note& n) {
    return std::isfinite(n.onset)&&std::isfinite(n.offset)&&n.onset>=0&&n.offset>n.onset&&
      n.pitch>=0&&n.pitch<=127&&n.program>=0&&n.program<=128;
}
inline void atomicReplace(const std::filesystem::path& partial,const std::filesystem::path& destination){
#ifdef _WIN32
    if(!MoveFileExW(partial.c_str(),destination.c_str(),
       MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
      throw std::runtime_error("Cannot replace resume checkpoint atomically");
#else
    std::filesystem::rename(partial,destination);
#endif
}
inline void save(const std::filesystem::path& file,const State& state,std::size_t samples,
                 std::uint64_t hash,int threads){
    if(state.resume.empty()||state.resume.size()>1000000||state.notes.size()>150000)
        throw std::runtime_error("Invalid checkpoint size");
    const auto partial=std::filesystem::path(file.wstring()+L".partial");
    try{
        std::ofstream o(partial,std::ios::binary|std::ios::trunc);
        if(!o)throw std::runtime_error("Cannot write resume checkpoint");
        o.imbue(std::locale::classic());
        o<<std::setprecision(17)<<"NOTIQ5MC1 "<<samples<<' '<<hash<<' '<<threads<<' '<<state.notes.size()<<'\n';
        o<<std::quoted(state.resume)<<'\n';
        for(const auto& n:state.notes){
            if(!validNote(n))throw std::runtime_error("Invalid finalized checkpoint note");
            o<<n.onset<<' '<<n.offset<<' '<<n.pitch<<' '<<n.program<<' '<<(n.is_drum?1:0)<<'\n';
        }
        o.close();
        if(!o)throw std::runtime_error("Checkpoint disk write failed");
        atomicReplace(partial,file);
    }catch(...){
        std::error_code ec;std::filesystem::remove(partial,ec);throw;
    }
}
inline State load(const std::filesystem::path& file,std::size_t samples,std::uint64_t hash,int threads){
    if(!std::filesystem::exists(file))return {};
    if(!std::filesystem::is_regular_file(file)||std::filesystem::file_size(file)>32000000)
      throw std::runtime_error("Checkpoint invalid or too large; reset the saved progress");
    std::ifstream in(file,std::ios::binary);
    in.imbue(std::locale::classic());
    std::string magic;std::size_t n=0,count=0;std::uint64_t fingerprint=0;int cpu=0;
    if(!(in>>magic>>n>>fingerprint>>cpu>>count) ||magic!="NOTIQ5MC1"||
       n!=samples||fingerprint!=hash||cpu!=threads||count>150000)
      throw std::runtime_error("Checkpoint incompatible with current audio or CPU threads");
    State data;
    if(!(in>>std::quoted(data.resume))||data.resume.empty()||data.resume.size()>1000000 ||
       data.resume.find("muscriptor-resume")!=0)
       throw std::runtime_error("Saved resume token invalid; reset progress");
    data.notes.reserve(count);
    for(std::size_t i=0;i<count;++i){
        msl::Note item;int drum=-1;
        if(!(in>>item.onset>>item.offset>>item.pitch>>item.program>>drum)||
           (drum!=0&&drum!=1)||!validNote(item))
           throw std::runtime_error("Checkpoint contains invalid note");
        item.is_drum=drum==1;
        data.notes.push_back(item);
    }
    std::string extra;
    if(in>>extra)throw std::runtime_error("Checkpoint contains unexpected trailing data");
    return data;
}
} // namespace notiq_checkpoint
