# Chuyển NOTIQ Web lên Cloudflare Pages

Trạng thái: **đã chuẩn bị mã nguồn; chưa liên kết Cloudflare, chưa phát hành URL pages.dev**.

## Kết nối trực tiếp Cloudflare + GitHub (không dùng GitHub Actions, không cần CMD)

1. Vào https://dash.cloudflare.com/ > **Workers & Pages** > **Create application** > **Pages** > **Import an existing Git repository / Connect to Git**.
2. Chọn tài khoản GitHub **Gamevalentine**, cấp quyền cho repo **Gamevalentine/NeuralNote** nếu Cloudflare yêu cầu.
3. Đặt **Project name** là `notiq-studio` nếu tên này còn trống; nếu đã trùng chọn tên khác. Đừng tự đoán URL trước khi Cloudflare cấp.
4. Chọn nhánh production **`feature/notiq-web-neuralnote-layout`**. Nếu màn hình tạo dự án chỉ cho `main`, chuyển production branch qua **Settings > Builds > Branch control** *trước khi dùng website làm bản chính*. Tuyệt đối không deploy `main` vì nhánh đó chỉ có mã C++ desktop.
5. Chọn framework **React / Vite**, hoặc **None** nếu thiết lập thủ công.
6. **Root directory (advanced)**: `web` (không phải thư mục gốc repository).
7. **Build command**: `npm run build`.
8. **Build output directory**: `dist` (so với root `web`).
9. Node.js: **22** (đã ghim bằng `web/.node-version`).
10. Nhấn **Save and Deploy**. Chỉ gửi URL **được Cloudflare cấp thật** sau khi trạng thái triển khai là **Success**.

Sau khi kết nối, Cloudflare tự xây dựng bản mới trên branch đã chọn khi thay đổi file `web/`. Không cần nhập API key, không chạy Actions và không chạm Windows/ổ C:.

## Cần kiểm tra sau khi Cloudflare cấp URL
- [ ] Website mở qua HTTPS, không lỗi 404 hoặc màn hình trắng.
- [ ] Waveform/Timeline/Piano Roll hiển thị, phím nốt và nút nghe hoạt động.
- [ ] Nhấn **Nhạc mẫu** để tải âm thanh mẫu và nghe được.
- [ ] Nhấn **Nhận diện**: trình duyệt tải model Basic Pitch từ CDN, tạo nốt thật (không tạo nốt giả).
- [ ] Mute/Solo ba **dải cao độ** hoạt động, không hiểu nhầm thành tách nhạc cụ.
- [ ] Xuất file .mid và thử mở trong DAW.
- [ ] Kiểm tra PC và điện thoại, thông báo lỗi CDN và file không hợp lệ.

## Tính năng hiện có và giới hạn

Bản Cloudflare dự kiến dùng code React/Vite và Basic Pitch chạy trực tiếp trên máy người dùng. Đây **không** phải bản chuyển NeuralNote v2 C++/MuScriptor lên trình duyệt: chưa nhận diện/tách nhóm nhạc cụ Piano, Guitar, Bass, Drums riêng; chưa có SoundFont nhạc cụ. Mô hình từ jsDelivr đòi hỏi mạng lúc khởi tạo. Giới hạn clip tối đa 45 giây và dung lượng 50 MB.

Nếu Cloudflare báo lỗi build, xem chi tiết trong **Deployments > View build log** rồi sửa code trên nhánh thử nghiệm. Không đổi production/main trước khi QA.

Nguồn chính thức:
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/build-configuration/
- https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
