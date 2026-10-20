# NOTIQ Web · LUNOR MUSIC

Bản thử nghiệm trên trình duyệt kế thừa giao diện NOTIQ đã duyệt, Piano Roll chỉnh sửa nốt, waveform, audio player, SoundFont, nhiều track và xuất MIDI cho DAW/Kontakt.

## Nhận diện Audio → MIDI (trạng thái nhánh này)
- **Động cơ duy nhất được gọi từ giao diện là MuScriptor C++ gốc của NeuralNote.** Không dùng kết quả nốt giả và không lặng lẽ thay bằng Basic Pitch.
- **Windows:** chạy qua IPC native bridge cũ của Electron.
- **Web:** chạy qua backend MuScriptor riêng trong thư mục \`notiq-api/\` khi \`VITE_NOTIQ_MUSCRIPTOR_API\` trỏ tới API HTTPS thực và kiểm tra /api/health đạt. Audio WAV được gửi lên backend thử nghiệm để inference, kết quả trả về Piano Roll; chỉ lưu tệp tạm trong thời gian xử lý.
- **Nếu chưa có API đang chạy:** giao diện, nghe nhạc và Piano Roll vẫn dùng được; NOTIQ không báo nhận diện giả.
- Nhập âm thanh tối đa 15 phút và 200 MB tệp nguồn (browser cần decode được); nén WAV nội bộ về 16kHz mono float32 để gửi backend (~57.6 MB cho 15 phút).
- Mô hình MuScriptor Small không nằm trong source/website. Backend tải theo yêu cầu, kiểm tra SHA-256; trọng số **CC BY-NC 4.0** chỉ phi thương mại.
- Khi bắt đầu nhận diện trên Web, người dùng nhập mã truy cập backend riêng; mã chỉ giữ theo phiên trong sessionStorage và không được hardcode vào bản dựng hay đưa lên GitHub.

## Phát triển, kiểm thử và triển khai
- Repo: \`Gamevalentine/NeuralNote\`. Nhánh thử nghiệm: \`feature/notiq-web-muscriptor-api-preview\`.
- Build giao diện \`web/package.json\` dùng React/Vite, giữ nguyên bố cục CSS và chức năng biên tập.
- Chạy kiểm tra code API riêng qua script \`notiq-api/package.json\`. Các test HTTP dùng mock worker **chỉ trong test**; không phải bằng chứng AI đã nhận diện thật.
- Cấu hình API thông qua môi trường Vite của **bản Preview**: \`VITE_NOTIQ_MUSCRIPTOR_API=https://<domain-api>\`. Không đưa token bí mật vào biến \`VITE_*\`.
- Chưa có triển khai thực tế thành công hoặc link Preview nhận diện MuScriptor end-to-end được xác nhận từ mã này. **Không chuyển sang Production, không merge main** khi chưa thử inference bằng file nhạc thật.

Thông tin backend, cài đặt model, giới hạn, bảo mật: xem [notiq-api/README.md](../notiq-api/README.md).

## Giấy phép và ghi công
UI + nhận diện kế thừa dự án [NeuralNote](https://github.com/DamRsn/NeuralNote) (Apache-2.0) và [muscriptor.cpp](https://github.com/DamRsn/muscriptor.cpp) (MIT), phần model MuScriptor GGUF theo CC BY-NC 4.0; SoundFont FluidR3 theo giấy phép phân phối tương ứng.
