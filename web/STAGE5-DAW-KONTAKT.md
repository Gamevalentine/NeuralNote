# NOTIQ Stage 5 — DAW / Kontakt MIDI handoff

## Mục tiêu
Giữ nguyên giao diện NOTIQ đã được chủ dự án duyệt. Thêm xuất MIDI phục vụ Cubase, Cakewalk và Kontakt, không bắt chạy CMD; duyệt trên Cloudflare branch preview trước khi đóng gói lại Windows.

## Các tính năng đã thực hiện
- **Xuất → MIDI đa track (.mid)**: xuất SMF Type 1 nhiều MIDI track, chứa chương trình nhạc cụ General MIDI, tempo BPM, pitch, onset/offset và velocity.
- **Xuất → Gói MIDI từng track (.zip)**: chứa tệp MIDI đa track, các `MIDI_TRACKS/*.mid` (một nhạc cụ mỗi file), và `README_DAW_KONTAKT.txt`.
- **Xuất track đang bật**: chọn chỉ nghe/xuất các track không Mute và được Solo.
- Track MuScriptor được nhóm theo `Note.program`, không chia theo cao độ; nốt trùng cao độ ở Piano và Violin vẫn ở hai track khác nhau.
- GM **trống channel 10** (chỉ số kênh 9), các nhạc cụ giai điệu dùng 15 kênh còn lại và có cảnh báo khi vượt 15 nhạc cụ.
- Track Basic Pitch lấy preset SoundFont người dùng đã chọn cho mỗi dải cao/trung/trầm.
- Menu **Hướng dẫn sử dụng Kontakt** trình bày đúng quy trình gán MIDI vào từng instrument và chọn thư viện `.nki` trong Kontakt.
- **Không tuyên bố kết nối trực tiếp đến API Kontakt** hoặc tự động nạp patch `.nki` vì ứng dụng Electron hiện chưa có cơ chế VST host; chỉ tương thích qua file MIDI.

## Kiểm thử
- `web/tests/daw-midi.test.mts` dùng chính `@tonejs/midi` đọc lại file đã xuất, kiểm tra MIDI program, đồng thời 2 nhạc cụ chơi một nốt, trống channel 10, BPM/sai số tick nhỏ hơn 1 ms, ZIP/stems và cảnh báo vượt kênh.
- Bộ regression Piano Roll, SoundFont và MuScriptor protocol được chạy lại trong GitHub QA.
- Chỉ coi Stage 5 preview sẵn sàng khi QA và Cloudflare Pages deployment đều thành công.
- **Chưa có kiểm thử Cubase / Cakewalk / Kontakt trên máy người dùng**; việc GitHub/Cloudflare chạy xanh chỉ xác nhận file hợp lệ, không xác nhận DAW đã nhập đúng trong một project cụ thể.

## Lệnh sử dụng trong hệ thống CI, không yêu cầu người dùng nhập
```
npm run test:daw
npm run test:piano
npm run test:soundfont
npm run build
```

## Quy tắc phát triển
Chỉ sửa `feature/notiq-stage5-daw-midi-export`, không merge main hoặc chạy đóng gói Windows trước khi người dùng kiểm thử và duyệt bản Web Stage 5.
