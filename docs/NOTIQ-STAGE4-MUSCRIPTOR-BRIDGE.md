# NOTIQ Giai đoạn 4 — MuScriptor C++ local engine

## Trạng thái và phạm vi
- Nhánh: `feature/notiq-stage4-native-muscriptor-bridge`, bắt nguồn từ `feature/notiq-web-stage3-soundfont`; KHÔNG đụng main, production Cloudflare hoặc các sản phẩm LUNOR khác.
- Giữ nguyên giao diện Piano Roll Stage 2 + SoundFont Stage 3.
- Trình duyệt Web/Cloudflare: vẫn sử dụng Basic Pitch. MuScriptor KHÔNG chạy trên website.
- Electron Windows portable: thêm tiến trình phụ C++ sử dụng chính submodule `ThirdParty/muscriptor.cpp` (pinned), CPU-only, không có Vulkan.
- Xây dựng hoàn toàn trên GitHub Actions, không cần CMD/Visual Studio trên máy người dùng.

## Luồng thật
1. Trong NOTIQ Windows, `Công cụ → AI: MuScriptor C++ (Windows)`. Web thường sẽ hiển thị tùy chọn đó bị khóa.
2. Nếu chưa có mô hình, nhấn `Tải mô hình MuScriptor Small (209 MB)`; người dùng chủ động tải một lần.
3. Main process Electron tải tệp từ Hugging Face URL pinned, kiểm tra kích thước **209425152 byte** và SHA-256 **925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4**; nếu sai sẽ xóa tệp tải dở. Không trộn model giả với model thật.
4. Model và cache lưu **cạnh ứng dụng portable** trong `models/` và `NOTIQ-Data/`, nên có thể đặt ở E: và tránh tải model 209 MB lên C:.
5. Renderer chuyển âm thanh sang WAV **16 kHz / mono / IEEE float32** bằng Web Audio (giới hạn 45s). Qua Electron `contextBridge` IPC, truyền byte cho main process. Không bật `nodeIntegration`.
6. Main tạo thư mục tạm bên cạnh ứng dụng portable và gọi **duy nhất** `resources/bridge-bin/notiq-muscriptor-cli.exe`, không shell và không thực thi tên file/lệnh do người dùng nhập.
7. CLI dùng `msl::Transcriber::load` + `transcribe` trả JSON schema 1: `startTimeSeconds`, `durationSeconds`, `pitchMidi`, `program`, `isDrum`, `amplitude`. Có tiến độ chuẩn hóa, file JSON tạm ghi an toàn.
8. React xác minh JSON, tạo track theo GM program thực (0–127 + trống 128), mute/solo/volume riêng. Xuất .mid theo từng chương trình; trống ở MIDI channel 10.

## Bản thử và những điểm chưa xong
- GIẤY PHÉP: muscriptor.cpp MIT; MuScriptor weights **CC BY-NC 4.0** (chỉ phi thương mại). Không nhúng hay đăng GGUF lên GitHub Artifacts/Release.
- SoundFont Web chỉ gồm một số preset FluidR3, nên **tiếng nghe thử với mã GM khác có thể gần đúng**; trường hợp program 128 (trống) hiện vẫn xuất MIDI được nhưng chưa có percussion SoundFont để nghe. Không gắn sample Piano giả làm drum.
- Electron chưa thay thế NOTIQ Standalone JUCE/VST3. Không tuyên bố hỗ trợ Kontakt nhúng/VST3 trong Electron.
- QA tự động xác minh Web/TypeScript/protocol, CLI biên dịch/khởi động trên Windows, gói Electron đủ EXE/assets/native. **Chưa chạy inference end-to-end với trọng số GGUF thật** vì không đóng gói model phi thương mại, vẫn cần nghe và xác nhận kết quả thực tế.
- Model 209 MB có thể tải chậm trên mạng yếu; cần không tắt app khi đang tải.
- Đây là bản preview riêng, chưa merge vào main hay ghi đè bản Windows được người dùng nghiệm thu.

## Đường dẫn theo dõi
- Native CLI riêng: https://github.com/Gamevalentine/NeuralNote/actions/runs/39405181989
- Web/protocol QA: https://github.com/Gamevalentine/NeuralNote/actions/runs/39406471182
- Electron Windows với engine: https://github.com/Gamevalentine/NeuralNote/actions/runs/39406665730

## Bước còn lại để nghiệm thu Giai đoạn 4
- GitHub xác nhận build Windows portable ZIP thành công.
- Người dùng giải nén vào E:, mở NOTIQ-Stage4.exe; chọn MuScriptor Small, tải GGUF và nhận diện đoạn âm thanh ngắn; xác nhận nhiều track xuất đúng MIDI.
- Nếu thử trực tiếp phát hiện lỗi, sửa trên nhánh stage4 mà không làm thay đổi Web production.
