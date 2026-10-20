# NOTIQ Web — kịch bản kiểm thử chức năng

Các kịch bản này **chưa được xác nhận chạy qua**; không thay thế kết quả QA thực tế.

| Trường hợp | Thao tác | Kết quả mong đợi |
| --- | --- | --- |
| 1. Ban đầu | Mở trang | Không có waveform/nốt giả, nút Nhận diện và Xuất MIDI không hoạt động |
| 2. Âm thanh mẫu | Bấm Nhạc mẫu | Waveform thật, thời lượng khoảng 3,8 giây, âm thanh có thể phát |
| 3. AI | Bấm Nhận diện sau khi chọn mẫu | Mô hình tải, tiến độ tăng, nốt nhận được hiển thị trên Piano Roll |
| 4. Nghe thử | Bấm phím đàn/nốt MIDI | Nghe được nốt phát từ oscillator, không dùng nhạc cụ giả lập |
| 5. Xuất MIDI | Chỉnh BPM và bấm Xuất MIDI | Tải file .mid chứa các nốt đã nhận diện với đúng thời điểm |
| 6. Dải nốt | Bật/tắt M, S của trầm/trung/cao | Chỉ ẩn/phát các nốt có đúng dải cao độ |
| 7. Phát lại | Phát, tạm dừng, về đầu, bật lặp, đổi chế độ nghe | Con trỏ thời gian khớp âm thanh; trạng thái nút đồng bộ |
| 8. Timeline | Bấm mốc giây, điều chỉnh zoom | Seek hoạt động, waveform và nốt giữ cùng trục thời gian |
| 9. File sai | Chọn tệp không phải audio hoặc audio lỗi | Hiện lỗi thật, không xuất MIDI giả |
| 10. File dài | Chọn audio > 45 giây | Hiện thông báo giới hạn, không chạy AI |
| 11. Lỗi tải model | Chặn jsDelivr hoặc mất mạng | Nhận diện báo lỗi rõ ràng, không tuyên bố thành công |
| 12. Thiết bị | Kiểm tra desktop và trình duyệt di động | Layout có thể thao tác và cuộn, piano keyboard thẳng hàng |
