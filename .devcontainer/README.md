# NOTIQ Web — GitHub Codespaces thử nghiệm, không cần CMD

Chỉ dùng nhánh `feature/notiq-web-muscriptor-api-preview`. Giữ nguyên bản NOTIQ production.

1. Từ GitHub nhánh thử nghiệm, bấm **Code → Codespaces → Create codespace on this branch**. Kiểm tra gói GitHub còn thời gian miễn phí trước khi bắt đầu; Codespaces có thể tính phí nếu tài khoản bật thanh toán.
2. Codespaces tự cài C++/Node, biên dịch **MuScriptor nguồn NeuralNote thật**, chạy các bài kiểm thử API và giao diện. Build có thể mất nhiều phút. **Không phải chạy CMD hay cài trên Windows**.
3. Trong Codespaces chọn thẻ **PORTS**, mở `NOTIQ Web • Audio → MIDI` (cổng 5173) trên trình duyệt. Cổng mặc định để **Private**, chỉ chủ Codespace đăng nhập GitHub truy cập.
4. Mở NOTIQ; tải bài hát, chờ tình trạng MuScriptor sẵn sàng (mô hình ~209 MB được tải và xác minh trên Codespaces). Nếu chưa nhận diện được, làm mới trang sau khi model sẵn sàng. Thử nhận diện và xuất MIDI.
5. Sau khi xong: **Stop Codespace** trên giao diện GitHub để không tiêu hao quota. Không để chạy 24/24.

Tự động mở một URL HTTPS tạm, **không phải** triển khai Cloudflare hay hosting cố định. Không thể coi là nghiệm thu cho đến khi nghe/nhìn thấy nốt từ bài hát thật. Vì hỗ trợ Linux của upstream muscriptor.cpp còn đang phát triển, quá trình biên dịch có thể thất bại; khi đó cần sửa theo log, không thay kết quả bằng dữ liệu giả.

Bảo mật: chỉ forward cổng **5173 Private**; backend MuScriptor ở localhost:8080, API key tự tạo trên Codespace trong `.notiq-preview/key`, không truyền vào trình duyệt, Vite proxy chèn khóa server-side. Không chia sẻ link/không đổi cổng sang Public. Tệp WAV và MIDI tồn tại tạm trong Codespace để inference; không dùng cho nội dung nhạy cảm.

**Hạn mức không được bảo đảm:** GitHub công bố 120 core-hours và 15 GB-month miễn phí hàng tháng cho tài khoản cá nhân Free (máy 2-core khoảng 60 giờ). Nếu hết quota và có phương thức thanh toán, có thể phát sinh phí; kiểm tra tại GitHub Billing trước khi tạo Codespace.
