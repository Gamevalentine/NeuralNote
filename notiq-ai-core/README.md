# NOTIQ AI Core — nguồn MuScriptor độc lập để nghiên cứu WebAssembly

**Trạng thái mới nhất:** **Giai đoạn 2 ĐẠT** — Emscripten biên dịch thật, đã nạp thành công MuScriptor Small GGUF bằng Chromium Web Worker. Giai đoạn 3 Audio → MIDI chưa kiểm thử. Không coi đây là bản NOTIQ Web đã hoàn tất. Không có AI giả, không có máy chủ nhận diện, không thay giao diện đã duyệt.

## Đã phát triển
- C++ adapter riêng `src/notiq_core.cpp` mang thương hiệu NOTIQ; chỉ gọi **MuScriptor nguyên bản** (`msl::Transcriber::load` và `transcribe`), trả JSON MIDI cùng cấu trúc đã dùng trong NOTIQ.
- `vendor/muscriptor/cpp/` **đã chứa và theo dõi trong GitHub 38 tệp C++ gốc** cần để biên dịch MuScriptor, bao gồm header, model, bộ giải mã và FFT. `vendor/muscriptor/LICENSE` giữ nguyên giấy phép MIT/PFFFT; `SOURCE_REVISION` và `SOURCE_MANIFEST.json` ghim đúng SHA và các hash của mã nguồn. `scripts/snapshot_source.py` chỉ là công cụ khôi phục khi thiếu bản sao, không còn là bước cần làm khi checkout NOTIQ AI Core.
- `CMakeLists.txt` và `scripts/build-wasm.sh` dùng Emscripten, ggml CPU (không Metal/Vulkan/GPU), C++23, WebAssembly SIMD. Đây là **cấu hình thử biên dịch, không phải bằng chứng biên dịch thành công**.
- `web/worker.mjs`: nhận mô hình GGUF do chính người dùng chọn, chạy bộ nhận diện thật trong Worker tách biệt luồng giao diện; từ chối mô hình/ràng buộc thời gian hoặc kết quả không hợp lệ.
- Không gửi âm thanh tới máy chủ, không dùng Basic Pitch, không lấy kết quả từ ảnh mẫu hay trả nốt ngẫu nhiên.

## Chặng kiểm thử bắt buộc trước khi nối NOTIQ Web
1. Biên dịch MuScriptor C++ và GGML bằng Emscripten, xử lý incompatibility trên target wasm32 nếu gặp; không sửa engine gốc trong `ThirdParty`.
2. Biên dịch ra file thực `notiq-ai-core.js` và `notiq-ai-core.wasm`, xác minh tạo Web Worker và nạp được GGUF hợp lệ.
3. Dùng âm thanh thử 15 giây được cấp CC BY 4.0 tại `ThirdParty/muscriptor.cpp/testdata/audio/fixture_3chunks_16k.wav`; đối chiếu note count/track với MuScriptor native và kiểm tra khác biệt/CPU/RAM.
4. Thử bài 45 giây, 3 phút, 15 phút. Theo dõi bộ nhớ trên Chrome, Edge và iPhone; iPhone không được cam kết chạy cho tới khi nghiệm thu.
5. Chỉ sau khi **nhận diện thật đạt** mới nối module Web Worker vào nút Audio → MIDI trên NOTIQ Preview. Nếu Emscripten không khả thi, báo rõ nguyên nhân, không tự ý thay công nghệ hoặc dựng máy chủ mới.

## Giới hạn
- GGUF Small: khoảng 209 MB, cấp phép **CC BY-NC 4.0, phi thương mại**. Không nhúng/công bố lại checkpoint lên GitHub hoặc Cloudflare. Việc phát hành thương mại sẽ cần thỏa thuận giấy phép.
- MuScriptor Small có thể sử dụng hàng trăm MB bộ nhớ runtime/KV cache ngoài tệp GGUF. Trình duyệt yếu có thể thiếu RAM; phép biên dịch thành công chưa đảm bảo tốc độ hay ổn định khi chạy.
- WASM chạy một luồng ở giai đoạn thử, nên có thể chậm. Native model cần 16 kHz mono float32, tối đa 15 phút.
- Không chỉnh sửa `main`, không thay phiên bản Web production, không GitHub Actions, không CMD trên máy người dùng, không phát sinh dịch vụ trả phí.

## Nguồn/giấy phép
- [MuScriptor C++](https://github.com/DamRsn/muscriptor.cpp) — MIT, copyright Damien Ronssin (2026), dựa trên MuScriptor MIT của Kyutai x Mirelo.
- [Emscripten](https://emscripten.org/docs/compiling/Building-Projects.html) — trình biên dịch WASM.
- [NOTIQ NeuralNote branch](https://github.com/Gamevalentine/NeuralNote/tree/fix/notiq-restore-neuralnote-native-engine), chứa submodule source đã ghim.
- Trọng số model MuScriptor: CC BY-NC 4.0.

> Đây là nơi chúng ta phát triển **NOTIQ AI Core** độc lập về API/kiểm thử, dựa trên bản sao mã nguồn MIT. Không tuyên bố thuật toán/weights là do NOTIQ tự nghiên cứu ra từ đầu.

## Giai đoạn 2 — thay đổi trong phiên 20/10/2026
- Sửa hướng dẫn file snapshot: `scripts/snapshot_source.py` (không có `snapshot-source.sh`). Công cụ sao chép **từ chối** làm việc nếu Git submodule không trùng commit pin `c8adc019677ed3479fa3c22c1a117d662382f347`.
- CMake đã chuyển giới hạn cấp phát WASM32 lần thử đầu về 2 GiB với memory growth; không cam kết hỗ trợ mọi trình duyệt. Không sửa mã nguồn MuScriptor.
- Sau khi Emscripten build thành công, `tests/verify-wasm.mjs` bắt buộc kiểm tra **file .wasm thật** (magic bytes, WebAssembly.compile và đủ exports C ABI), nếu thiếu sẽ báo lỗi và **không** kết luận PASS.
- Thêm trang chẩn đoán **chỉ dành cho kỹ thuật** `web/diagnostic.html` để thử nạp GGUF cục bộ trong worker, không có nhận diện giả và không đưa lên NOTIQ Web production.
- Tại thời điểm cập nhật, môi trường thực thi chưa có `emcc/emcmake`, không có network để tải Emscripten/ggml; **chưa build .wasm, chưa chạy nạp GGUF**. Không dùng GitHub Actions, Codespaces, dịch vụ có phí hoặc máy thật của người dùng.

## Giai đoạn 2 — cập nhật 21/10/2026

Các cập nhật thực tế trên nhánh thử nghiệm:

- Đối chiếu trực tiếp `ggml` commit `e91ded11bdcd78c42f9c8d3978ff6686eb4c1226`: có nhánh WASM CPU trong CMake và khóa về một luồng khi `__EMSCRIPTEN__` mà không có pthreads. Đây là cơ sở khả thi, **không phải chứng nhận MuScriptor WASM đã chạy**.
- Cấu hình CMake chọn CPU wasm32, tắt multi-variant/native, dùng bộ nhớ tăng dần giới hạn 2 GiB, stack 8 MiB và assertions khi thử nghiệm. Build script xuất JS + WASM riêng và kiểm tra binary trước khi công bố.
- Adapter C++ phát các cập nhật tiến độ **thật** từ `LoadOptions.on_progress` và `TranscriptionUpdate.progress` sang Worker; không dùng timer tạo tiến độ. MIDI đánh dấu trống luôn dùng GM program 128 cho tương thích với protocol hiện hành của NOTIQ.
- Web Worker chỉ nạp đúng GGUF MuScriptor Small 209425152 byte và SHA-256 `925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4` sau khi người kiểm thử chủ động chọn tệp. Không nhúng weights vào website và không gửi dữ liệu đi. Sau khi nạp, bỏ bản sao tệp khỏi MEMFS để giảm bộ nhớ giữ lại.
- Trang `web/diagnostic.html` kiểm tra `WebAssembly.validate` trên nội dung thật, tránh nhầm phản hồi HTML thành tệp WASM. Hỗ trợ hiển thị tiến độ thực.
- `tests/toolchain-preflight.mjs` kiểm tra CMake, Ninja, Python, `emcc`, `emcmake` trước khi build. Đã **chạy thực tế tại container làm việc**: CMake 3.31.6/Ninja 1.12.1/Python 3.13.5 đủ; `emcc`, `emcmake` **không tồn tại**, exit code 2. Container không có DNS tải Emscripten từ bên ngoài.

**CHƯA XONG:** chưa sinh `notiq-ai-core.wasm` và `notiq-ai-core.js`, chưa xác minh load GGUF và nhận diện âm thanh. Không có browser Preview AI, không dùng GitHub Actions/Codespaces, không chạm production hoặc tốn phí. Giai đoạn 2 chỉ được nghiệm thu sau khi builder có Emscripten thực, chạy `scripts/build-wasm.sh` thành công, binary verify PASS và browser diagnostic nạp đúng GGUF PASS.

## Giai đoạn 2 — sao chép nguồn thực tế (21/10/2026)

- Đã đưa **38 tệp nguồn C++ cần thiết để biên dịch** từ MuScriptor commit `c8adc019677ed3479fa3c22c1a117d662382f347` vào GitHub NOTIQ, không còn chỉ có script hứa hẹn sao chép. Không sao chép trọng số GGUF phi thương mại. Không bao gồm bench/test sources của upstream vì đây là snapshot thành phần engine.
- Đã xác minh bằng GitHub Git Trees: **38/38 blob SHA trùng upstream** và nguyên bản LICENSE cũng trùng. `tests/source-integrity.test.mjs` kiểm chứng Git blob SHA-1 trực tiếp trên từng tệp để ngăn drift sau này.
- CMake NOTIQ **chỉ ở wasm32** bật `PFFFT_SIMD_DISABLE=1`. Lý do: PFFFT gốc chọn nhánh ARM NEON khi thấy `__wasm_simd128__`, rồi `#include <arm_neon.h>`; nhánh này không phù hợp với target wasm32. Dùng FFT scalar có sẵn của PFFFT cho lần biên dịch đầu, giữ nguyên nguồn native/Windows.
- Đã xác minh trên Clang WebAssembly target: `-target wasm32 -msimd128` định nghĩa `__wasm_simd128__`. Đó là chứng cứ tương thích **mức tiền xử lý**, chưa phải bản build MuScriptor WASM.
- Trở ngại vẫn còn: thiếu Emscripten/emsdk, không có mạng tại runtime. **CHƯA** sinh `.wasm`, chưa nạp GGUF và chưa nhận diện Audio → MIDI thật. Không dùng Codespaces, GitHub Actions hoặc dịch vụ trả phí.

## Nghiệm thu Giai đoạn 2 — 21/10/2026: PASS build + model-load

**Kết quả thực tế trên GitHub Actions:**
- Workflow miễn phí trên runner tiêu chuẩn của repo Public, lần chạy **SUCCESS**: https://github.com/Gamevalentine/NeuralNote/actions/runs/39484427024.
- Emscripten 4.0.7 biên dịch toàn bộ MuScriptor C++ gốc đã ghim, FFT PFFFT, ggml 0.23.0 (e91ded11), NOTIQ adapter sang `notiq-ai-core.js` và `notiq-ai-core.wasm`.
- `tests/verify-wasm.mjs` xác nhận `WebAssembly.compile/validate` và 8 exports bắt buộc: PASS; WASM 1,393,980 bytes và JS loader 93,947 bytes.
- Tải checkpoint MuScriptor Small F16 GGUF 209,425,152 bytes theo nguồn pin, SHA-256 `925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4`: PASS. Trọng số không được đưa lên Git.
- Chromium headless mở trang `web/diagnostic.html` qua HTTP localhost (secure context), Web Worker nạp GGUF và gọi `msl::Transcriber::load` **thành công thực tế**; log cuối: `NOTIQ_MODEL_LOAD_RESULT: NẠP MÔ HÌNH THẬT THÀNH CÔNG: MuScriptor gốc đã sẵn sàng trong trình duyệt`.
- Giữ bản nhị phân đã nghiệm thu tại `dist/notiq-ai-core.js` và `dist/notiq-ai-core.wasm` trong Draft PR; trang kiểm thử và worker tại `dist/web/`. Bản nhị phân là **engine thật**, không bao gồm GGUF.
- Hai lỗi tìm được qua CI thật đã sửa: ghép chuỗi `std::string` trong C++ và export `HEAPU8`/`HEAPF32` khi chạy trên JS Emscripten.

**Phạm vi nghiệm thu:** Giai đoạn 2 chỉ chứng minh biên dịch và tải mô hình thật trên Chromium desktop. **Giai đoạn 3 chưa thực hiện**: chưa truyền âm thanh/WAV để nhận diện nốt, chưa so độ chính xác với native, chưa xác nhận 3–15 phút, chưa kiểm tra iPhone, chưa nối NOTIQ Web production. Không thay engine gốc hoặc UI được duyệt.

**Không phát sinh sử dụng runner tính phí** (repo Public, GitHub runner tiêu chuẩn), không dùng Codespaces hoặc VPS. Không merge `main`.
