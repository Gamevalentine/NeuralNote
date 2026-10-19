# NOTIQ — Bước 2: Việt hóa giao diện (thử nghiệm)

## Phạm vi

Nhánh `feature/notiq-stage2-vietnamese-ui` được tạo từ `feature/notiq-stage1-branding`. Chỉ thay đổi chuỗi hiển thị, tên nhạc cụ, hướng dẫn và thông báo. Không thay đổi giải thuật MuScriptor, kiểm tra checksum, định dạng GGUF, lưu file MIDI hay giao thức model API.

- Các nút điều khiển: ghi âm, phát/tạm dừng, lặp, tắt tiếng, mở nguồn âm thanh.
- Chọn nhóm nhạc cụ: 35 tên hiển thị tiếng Việt; giữ enum/ID và từ viết tắt ổn định.
- Chọn mô hình: nhãn kích thước Nhỏ/Vừa/Lớn; GIỮ NGUYÊN `small/medium/large` trong file cấu hình và tên model.
- Quy trình xử lý: nhận diện nốt, tạm dừng/tiếp tục, thông báo tiến độ.
- Xuất MIDI: nút xuất, BPM, kéo file vào DAW, các lỗi.
- Cài đặt: GPU/CPU, độ phóng to, kênh xuất MIDI, nhật ký, báo cáo sự cố, kiểm tra cập nhật.
- Trình cài đặt Windows: văn bản hướng dẫn, thành phần và thông báo gỡ cài đặt.

## Kiểm thử còn phải thực hiện trước khi merge

- [ ] Build Windows x64 với công cụ CMake/Clang theo hướng dẫn upstream (chưa chạy để tiết kiệm quota).
- [ ] Khởi động NOTIQ standalone và VST3; kiểm tra dấu tiếng Việt (đ, ă, â, ê, ô, ơ, ư) bằng font Inter đi kèm.
- [ ] Kiểm tra chữ không bị cắt/đè: TopBar, Model Panel, menu Nhạc cụ, Sidebar, StatusBar, Toolbar, thông báo.
- [ ] Mở WAV/MP3; nhận diện bằng MuScriptor small; kiểm tra số lượng nốt, nghe lại, tạm dừng/tiếp tục.
- [ ] Đổi mô hình qua Nhỏ/Vừa/Lớn, đóng/mở rồi kiểm tra cấu hình `small/medium/large` vẫn được giữ.
- [ ] Xuất MIDI và kéo vào DAW; không bị thay đổi cao độ/thời điểm khi so với nhánh B1.
- [ ] Thử tải mô hình trong trạng thái lỗi mạng, mất kết nối và tải tiếp.
- [ ] Chạy NOTIQ song song NeuralNote gốc; xác nhận file, model và thông tin gỡ cài đặt hoàn toàn độc lập.

## Giới hạn

Chưa có kết quả biên dịch hoặc nghiệm thu giao diện thật. Repo GitHub vẫn tên `Gamevalentine/NeuralNote` vì là fork; nhận diện sản phẩm desktop đã đổi thành NOTIQ ở Bước 1. NOTIQ Web là ứng dụng thử nghiệm khác, chạy Basic Pitch; không được đánh đồng với bản NeuralNote/MuScriptor C++.

Dự án dựa trên NeuralNote (Apache-2.0). Trọng số AI MuScriptor (CC BY-NC 4.0) không được phép dùng thương mại nếu chưa có quyền thích hợp.
