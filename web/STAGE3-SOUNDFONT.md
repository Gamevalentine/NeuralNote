# NOTIQ — Giai đoạn 3: Bộ tiếng nhạc cụ SoundFont

Tích hợp **soundfont-player** (MIT) vào NOTIQ Web: phát **mẫu nhạc cụ thật** bằng Web Audio, không còn dùng oscillator triangle để phát nốt.

**Nguồn mẫu:** [FluidR3_GM pre-rendered samples](https://gleitz.github.io/midi-js-soundfonts/) bởi Benjamin Gleitzman, phái sinh FluidR3 của Frank Wen, công bố theo **CC BY 3.0** theo tài liệu nguồn. Ghi công và liên kết nguồn trong giao diện. Không đóng gói hoặc tự công bố bộ mẫu riêng trong repository.

## Các chức năng

- Mỗi dải cao/trung/trầm có thể chọn: Piano, Guitar mộc, Bass điện, Violin, Flute hoặc Marimba.
- Đầu tiên chọn tiếng/bấm phím hoặc Play để tải mẫu MP3 theo nhu cầu qua HTTPS. Âm thanh phát từ sample thật, không phát synth giả trong trường hợp mạng lỗi.
- Tái sử dụng ngân hàng mẫu đã tải cho các nốt tiếp theo.
- Phát lại nốt đã nhận diện hoặc nhập bằng tay; âm lượng mỗi dải và master volume, mute/solo vẫn được áp dụng.
- MIDI xuất bằng General MIDI Program Change tương ứng với lựa chọn nhạc cụ của từng dải.
- Không đổi bố cục chính của Piano Roll/menu; vẫn dùng Basic Pitch nhận diện *cao độ*, không phân loại nhạc cụ.

## Giới hạn cần kiểm thử

- Ngân hàng mẫu nhạc cụ lấy từ bên ngoài, cần mạng khi tải lần đầu; có thể hơi lâu nếu kết nối yếu. Nếu tải thất bại, hiển thị lỗi rõ, không tự đánh tráo bằng oscillator.
- Chưa hỗ trợ SoundFont SF2/SF3 tùy biến hoặc Kontakt/.nki trong browser.
- MuScriptor là engine C++ của NOTIQ Desktop và **chưa có trong Web**.
- CI kiểm tra typecheck, unit tests và Vite bundle; vẫn cần người dùng nghe thử trực tiếp trên Chrome/Windows để xác nhận chất lượng sample và âm lượng.
- Không thay đổi main, nhánh Web production, hay bản Electron đã đóng gói. Chỉ merge sau khi chủ dự án nghiệm thu.

## Ghi công và giấy phép

- soundfont-player: MIT, https://github.com/danigb/soundfont-player
- FluidR3_GM converted browser samples: CC BY 3.0, https://gleitz.github.io/midi-js-soundfonts/
- Original FluidR3 SoundFont: Frank Wen; conversion/browser hosting: Benjamin Gleitzman.
