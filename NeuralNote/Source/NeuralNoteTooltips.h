//
// Created by Damien Ronssin on 01/12/2024.
//

#ifndef NEURALNOTETOOLTIPS_H
#define NEURALNOTETOOLTIPS_H

#include <JuceHeader.h>

namespace NeuralNoteTooltips
{
// Controls

const String record = juce::String::fromUTF8("Thu âm | r");

const String clear = juce::String::fromUTF8("Xóa nốt đã nhận diện, sau đó xóa âm thanh | Shift + Backspace\nHủy lượt nhận diện đang chạy");

const String play_pause = juce::String::fromUTF8("Phát / Tạm dừng | Space");

const String back = juce::String::fromUTF8("Về đầu | Shift + Space");

const String center = juce::String::fromUTF8("Đưa con trỏ vào giữa | c");

const String loop = juce::String::fromUTF8("Phát lặp | l");

const String settings = juce::String::fromUTF8("Cài đặt");

const String mute = juce::String::fromUTF8("Tắt / Bật tiếng đầu vào | m");

const String pause_transcription = juce::String::fromUTF8("Tạm dừng nhận diện; các nốt đã tìm thấy vẫn được giữ");

const String resume_transcription = juce::String::fromUTF8("Tiếp tục nhận diện");

const String model = juce::String::fromUTF8("Chọn mô hình AI hoặc tải mô hình khác");

const String stop_model_download = juce::String::fromUTF8("Dừng tải; có thể tiếp tục từ nơi đã dừng");

const String transcribe = juce::String::fromUTF8("Nhận diện nốt từ âm thanh đã tải");

const String load_audio = juce::String::fromUTF8("Mở tệp âm thanh");

const String add_instrument = juce::String::fromUTF8("Chỉ nhận diện các nhạc cụ đã chọn");

const String export_tempo = juce::String::fromUTF8("Chọn BPM của tệp MIDI xuất ra");

const String source_audio_level = juce::String::fromUTF8("Điều chỉnh âm lượng âm thanh gốc");

const String internal_synth_level = juce::String::fromUTF8("Điều chỉnh âm lượng MIDI");

} // namespace NeuralNoteTooltips

#endif //NEURALNOTETOOLTIPS_H
