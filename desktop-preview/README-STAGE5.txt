NOTIQ WINDOWS PORTABLE — GIAI ĐOẠN 5 (CẢ BÀI HÁT / MIDI / DAW)
==============================================================
NOTIQ Stage 5 bao gồm: giao diện Piano Roll đã duyệt, SoundFont,
MuScriptor C++ native CPU và xuất MIDI cho Cubase, Cakewalk, Kontakt.

CÁCH MỞ — KHÔNG CẦN CMD
1. Tải ZIP từ GitHub Actions / Artifacts rồi giải nén TOÀN BỘ
   vào E:\LUNOR\NOTIQ-Stage5 (hoặc ổ khác, ưu tiên không phải C:).
2. Nhấp đúp NOTIQ-Stage5-FullSong.exe. Giữ nguyên các file resources
   và thư viện DLL đi kèm EXE.
3. Bấm Tải bài hát ở thanh trên cùng, chọn MP3/WAV/M4A/FLAC/OGG,
   hoặc mở Tệp → Tải bài hát / mở âm thanh.
4. Nếu dùng engine MuScriptor: Công cụ → AI: MuScriptor C++
   (Windows), sau đó Công cụ → Tải mô hình MuScriptor Small
   khi cần (209 MB, tải và lưu bên cạnh EXE).
5. Nhấn Nhận diện Audio → MIDI, chỉnh nốt trong Piano Roll.

XUẤT FILE DÙNG VỚI CUBASE / CAKEWALK / KONTAKT
Vào menu Xuất:
- MIDI đa track (.mid) → file MIDI Type 1, nhập vào Cubase/Cakewalk.
- Gói MIDI từng track (.zip) → file ALL_TRACKS.mid, MIDI_TRACKS/
  (1 MIDI cho mỗi nhạc cụ) và README_DAW_KONTAKT.txt.
- Các lựa chọn 'Chỉ xuất track đang bật' sẽ áp dụng Mute/Solo.
- Nốt trống MuScriptor giữ kênh 10 theo General MIDI.
- MIDI track riêng giúp gán thư viện Kontakt (.nki) thủ công trong DAW.
  NOTIQ CHƯA thể tự tải .nki vào Kontakt hoặc làm VST host.

Nếu đã tải MuScriptor Small ở bản Stage 4, có thể chép tệp
models\muscriptor-small-f16.gguf từ thư mục NOTIQ-Stage4
sang thư mục models\ tương ứng bên cạnh NOTIQ-Stage5.exe.
Lưu ý model phải đúng phiên bản, không đổi tên tệp.

GIỚI HẠN
- Hỗ trợ bài hát đến 15 phút hoặc 200 MB, thay cho giới hạn 45 giây.
- Trên Web Basic Pitch xử lý theo từng đoạn 25 giây có vùng chồng lấn
  và ghép nốt lên Piano Roll; máy yếu có thể xử lý lâu.
- Native MuScriptor chạy toàn bộ bài trên CPU, có thể tốn nhiều phút
  hoặc lâu hơn tùy cấu hình máy và độ dài bài hát.
- MuScriptor model ~209 MB có giấy phép CC BY-NC 4.0:
  chỉ dùng phi thương mại; không kèm GGUF trong ZIP.
- Các nhạc cụ SoundFont chưa phủ hết tất cả GM programs;
  tiếng trống chưa có bộ sample đầy đủ. MIDI drum được giữ đúng.
- Bản này đã được GitHub kiểm tra biên dịch và chạy smoke-test
  engine, nhưng cần thử trực tiếp trong ứng dụng/DAW của bạn.
- Có thể xuất hiện Windows SmartScreen vì bản thử chưa ký số.
- Không ghi đè hoặc chỉnh sửa bản Stage 4 đang sử dụng.

MÃ NGUỒN
https://github.com/Gamevalentine/NeuralNote
