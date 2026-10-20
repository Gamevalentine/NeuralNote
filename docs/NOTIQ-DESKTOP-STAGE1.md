# NOTIQ Desktop — Giai đoạn 1: Rà soát và sửa cấu hình build

## Phạm vi

Nhánh gốc: `feature/notiq-stage2-vietnamese-ui` (PR #2). Nhánh sửa riêng: `fix/notiq-desktop-build-readiness`.
Không merge vào `main`, không chạm thư mục `web/`, không chạy GitHub Actions và không cài gì trên máy người dùng.

## Đã đối chiếu trực tiếp từ mã nguồn

- `CMakeLists.txt` vẫn giữ `BaseTargetName=NeuralNote` cho tên target nội bộ, nhưng `PRODUCT_NAME=NOTIQ` cho ứng dụng được tạo.
- Windows có hai target `NeuralNote_Standalone` và `NeuralNote_VST3`; bộ cài mong đợi `NOTIQ.exe` và `NOTIQ.vst3`.
- `ThirdParty/JUCE` và `ThirdParty/muscriptor.cpp` là Git submodules.
- `InstrumentSynth` dùng TinySoundFont và SoundFont `NeuralNote_GM.sf3`. Tệp này được tạo lúc build, KHÔNG nằm sẵn trong Git.
- PR #2 chủ yếu thay chuỗi giao diện hiển thị bằng tiếng Việt; chưa có bản Desktop biên dịch hoặc nghiệm thu runtime.
- `configure_and_build.py` và workflow Windows hiện tại mặc định dùng clang-cl, Vulkan SDK, ccache, ASIO và PDB. Đây **không phải** cấu hình CPU nhẹ cho máy người dùng.

## Sửa trong giai đoạn 1

1. `Tools/fetch_soundfont.py`: khi Python gặp `SSLCertVerificationError` trên Windows thì thử lại bằng `curl.exe` dùng kho chứng chỉ Windows. Không dùng chế độ bỏ kiểm tra TLS. Giữ SHA-256 đã cố định cho 4 tệp gốc trước khi lưu file chính.
2. `CMakeLists.txt`: kiểm tra SHA-256 của `NeuralNote_GM.sf3` đã lưu (sha256 `6152b329bfb7c57c73112e26452e6b61909b19df1f146351bab85a5f3b0ea0aa`) trước khi nhúng vào ứng dụng; khi sai checksum sẽ báo lỗi, không tự xóa.
3. `CMakePresets.json`: cấu hình `notiq-windows-cpu` dùng MSVC Visual Studio 2026, x64, build Release, giới hạn 2 jobs; tắt Vulkan, ASIO, LTO, debug symbols. Đầu ra tại `build-cpu/`, không đè build chính.

## Ranh giới và chặng tiếp theo

- Chưa chạy build Windows hoặc nghe âm thanh thật; chỉ kiểm tra trực tiếp nội dung nguồn, CMake và preset. Bước 1 là chuẩn bị mã nguồn, **không phải bằng chứng có `.exe` chạy được**.
- Nếu nguồn không truy cập được bằng cả Python TLS và Windows curl, chương trình vẫn dừng an toàn và cho biết lỗi; không hứa tải được khi mạng hoặc CA Windows hỏng.
- Bộ cài Windows hiện tại ở `.github/scripts/package_windows.py` vẫn yêu cầu PDB và Inno Setup theo luồng CI cũ. Bản CPU không có PDB nên cần cập nhật riêng ở giai đoạn đóng gói; không dùng trực tiếp script cũ để tạo installer cho preset mới.
- Giai đoạn 2: chạy build Windows x64 trên nhánh thử; kiểm tra có `NOTIQ.exe`, `NOTIQ.vst3` thực tế, kiểm thử mở ứng dụng, tải model MuScriptor, nhận diện, phát SoundFont, xuất MIDI và thử với DAW/Kontakt.
- Giấy phép trọng số MuScriptor chỉ cho phi thương mại theo CC BY-NC 4.0; các ghi công gốc phải được giữ.

## Lệnh tham khảo nội bộ (không yêu cầu chủ dự án tự gõ)

```text
cmake --preset notiq-windows-cpu
cmake --build --preset notiq-windows-cpu
```

Cấu hình preset đã được lưu ở repo để một workflow build Windows về sau sử dụng; hiện chưa được chạy.
