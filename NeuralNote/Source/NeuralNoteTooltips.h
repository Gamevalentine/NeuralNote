//
// Created by Damien Ronssin on 01/12/2024.
//

#ifndef NEURALNOTETOOLTIPS_H
#define NEURALNOTETOOLTIPS_H

#include <JuceHeader.h>

namespace NeuralNoteTooltips
{
// Controls

const String record = "Thu âm | r";

const String clear = "Xóa nốt đã nhận diện, sau đó xóa âm thanh | Shift + Backspace\nHủy lượt nhận diện đang chạy";

const String play_pause = "Phát / Tạm dừng | Space";

const String back = "Về đầu | Shift + Space";

const String center = "Đưa con trỏ vào giữa | c";

const String loop = "Phát lặp | l";

const String settings = "Cài đặt";

const String mute = "Tắt / Bật tiếng đầu vào | m";

const String pause_transcription = "Tạm dừng nhận diện; các nốt đã tìm thấy vẫn được giữ";

const String resume_transcription = "Tiếp tục nhận diện";

const String model = "Chọn mô hình AI hoặc tải mô hình khác";

const String stop_model_download = "Dừng tải; có thể tiếp tục từ nơi đã dừng";

const String transcribe = "Nhận diện nốt từ âm thanh đã tải";

const String load_audio = "Mở tệp âm thanh";

const String add_instrument = "Chỉ nhận diện các nhạc cụ đã chọn";

const String export_tempo = "Chọn BPM của tệp MIDI xuất ra";

const String source_audio_level = "Điều chỉnh âm lượng âm thanh gốc";

const String internal_synth_level = "Điều chỉnh âm lượng MIDI";

} // namespace NeuralNoteTooltips

#endif //NEURALNOTETOOLTIPS_H
