NOTIQ WEB PREVIEW — Windows x64
================================
Bản thử giao diện NOTIQ từ website https://neuralnote-e4c.pages.dev/
Là ứng dụng Windows portable, không cần CMD hoặc cài Visual Studio.

Cách mở: giải nén toàn bộ thư mục, nhấp đúp NOTIQ-Web-Preview.exe.
Không di chuyển EXE ra khỏi thư mục; các DLL/resources đi cùng là bắt buộc.
Có thể xuất hiện cảnh báo Windows vì bản thử chưa được ký số.

Mục đích: xem giao diện giống Web, thử menu, bàn phím, nhập file audio,
nhận diện qua Basic Pitch, nghe thử oscillator, xuất MIDI.
Bấm 'Duyệt Desktop' để kiểm tra từng vùng giao diện. Model Basic Pitch
cần kết nối Internet với CDN ở lần sử dụng; giới hạn audio 45 giây/50 MB.

QUAN TRỌNG: KHÔNG PHẢI NOTIQ NATIVE:
- Không có engine MuScriptor, không có SoundFont GM, Kontakt/VST3.
- Chưa xử lý được nhận diện và phân loại nhạc cụ như ứng dụng Desktop C++.
- Chỉ dùng để chốt UI trước khi tích hợp với engine NOTIQ gốc.

Mã nguồn: https://github.com/Gamevalentine/NeuralNote
Bản preview không sửa bản NOTIQ đang cài.
