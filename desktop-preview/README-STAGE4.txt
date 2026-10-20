NOTIQ STAGE 4 — MU SCRIPTOR NATIVE WINDOWS PREVIEW
=================================================
Bản thử Giai đoạn 4 tích hợp NOTIQ Web/Piano Roll/SoundFont với
MuScriptor C++ chạy riêng trên Windows bằng CPU.

HƯỚNG DẪN
1. Giải nén toàn bộ vào E:\LUNOR\NOTIQ-Stage4. Đừng di chuyển riêng EXE.
2. Nhấp đúp NOTIQ-Stage4.exe, không cần CMD.
3. Mở mục Công cụ → Engine nhận diện → MuScriptor (Windows).
4. Nhấn Tải mô hình MuScriptor Small (209 MB) khi ứng dụng yêu cầu.
5. Chọn file âm thanh <= 45 giây, nhấn Nhận diện Audio → MIDI.

GIỚI HẠN
- Model ~209 MB tải từ HuggingFace, CHỈ sau khi người dùng bấm nút.
- Tệp model lưu tại thư mục models/ BÊN CẠNH EXE (để ở ổ E:).
- GGUF weights CC BY-NC 4.0: chỉ dùng phi thương mại;
  không kèm model trong bộ cài; tuyệt đối không phân phối thương mại.
- Engine Native chạy CPU, có thể mất nhiều phút cho 45 giây âm thanh.
- Trang NOTIQ Web/Cloudflare vẫn dùng Basic Pitch.
- VST3/Kontakt chưa nằm trong bản Electron này.
- Giao diện Electron là bản preview để QA; không thay thế bản đang dùng.

GHI CÔNG
MuScriptor (Kyutai/Mirelo), cổng C++ của Damien Ronssin (MIT).
https://github.com/DamRsn/muscriptor.cpp
https://huggingface.co/DamRsn/muscriptor-gguf
