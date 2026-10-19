# NOTIQ Web Studio · LUNOR MUSIC

Bản thử nghiệm web độc lập, bố cục lấy cảm hứng từ ứng dụng [NeuralNote v2](https://github.com/DamRsn/NeuralNote), **không** phải bản biên dịch NeuralNote C++ sang trình duyệt.

## Chức năng đã viết trong mã nguồn

- Nhập âm thanh WAV, MP3, FLAC, OGG, M4A (phụ thuộc hỗ trợ của trình duyệt), tối đa 45 giây / 50 MB.
- Đọc waveform thực từ tệp âm thanh đã chọn, timeline, nhấn mốc thời gian để tìm vị trí và con trỏ chạy theo âm thanh.
- Nhận diện cao độ và trường độ bằng [Spotify Basic Pitch](https://github.com/spotify/basic-pitch-ts), chạy AI trong trình duyệt.
- Piano Roll theo từng nốt thực tế; bàn phím phát thử từng nốt; phân nhóm nốt theo **dải cao độ** (trầm / trung / cao).
- Phát bản gốc, nghe thử nốt MIDI bằng bộ tổng hợp sóng cơ bản hoặc kết hợp; phát/tạm dừng, về đầu, lặp, seek.
- Mute, solo và âm lượng của từng dải cao độ; phóng to/thu nhỏ timeline; điều chỉnh BPM và xuất MIDI với các track dải cao độ.
- Giao diện và thông báo tiếng Việt.

**Giới hạn quan trọng:** Basic Pitch không nhận dạng được nhạc cụ cụ thể và không tách riêng Piano, Guitar, Bass hay Drum như engine MuScriptor đa nhạc cụ của NeuralNote v2. Các nút `M/S` chỉ điều khiển dải cao độ, **không phải stem/instrument separation**. Synth chỉ là sóng triangle thử nốt, không phải nhạc cụ SoundFont từ NeuralNote. Bản web chưa được chạy QA nghiệm thu.

## Cách xây dựng

Từ thư mục `web`: cài dependencies theo `package.json`, chạy `npm run build`, hoặc `npm run dev` trong môi trường phát triển miễn phí. Không yêu cầu chạy lệnh trên máy thật của người dùng.

Ứng dụng cần HTTPS và kết nối mạng để tải mô hình từ jsDelivr trong lần chạy AI đầu tiên. Chưa dùng cơ sở dữ liệu, không tải audio của người dùng lên máy chủ.

## Phát hành

- Phát triển trên nhánh `feature/notiq-web-neuralnote-layout`; không merge vào `main`.
- Link NOTIQ Web đang chạy trước đó **không tự động nhận thay đổi** từ thư mục này.
- Chỉ triển khai bản test và kiểm tra thực tế trước khi chuyển từ link test sang bản người dùng đang dùng.
- Dữ liệu và tính năng desktop NOTIQ (fork NeuralNote + MuScriptor) trong PR #1/#2 không bị thay thế.
- Giữ giấy phép và ghi công của mã gốc: NeuralNote code Apache-2.0, Spotify Basic Pitch Apache-2.0; trọng số MuScriptor CC BY-NC 4.0 không được phép sử dụng thương mại nếu thiếu giấy phép.

## Nghiệm thu cần làm

- [ ] Build Vite + TypeScript thành công.
- [ ] Dùng âm thanh mẫu, kiểm tra waveform, thời lượng, nút phát/tạm dừng.
- [ ] Chạy AI ra nốt thực tế, xem Piano Roll và nghe từng nốt.
- [ ] Mute/solo dải nốt, thay BPM, tải tệp MIDI và mở trong DAW.
- [ ] Kiểm tra file hỏng, file dài hơn 45 giây, lỗi mạng CDN.
- [ ] Kiểm tra màn hình nhỏ, kéo/phóng timeline và vị trí bàn phím khi cuộn.
