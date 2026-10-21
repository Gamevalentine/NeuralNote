# NOTIQ Stage 5D — Shared transport and honest AI status

Scope: React UI used in NOTIQ browser and the Windows/native bridge view.

- Visible, accessible **Mở bài**, **Phát/Tạm dừng**, **Dừng**, **Lặp**, **Đóng bài**, and a playback time counter. They mirror existing menu actions.
- MIDI-only pause/resume keeps paused position; Stop resets to 00:00. Stop/Pause/Seek/Open/Recognize silence active SoundFont voices and invalidate pending sample-load notes. Async playback requests cannot resume after Stop.
- During recognition, an overlay appears **centered over Piano Roll**. It shows two truthful stages (audio preparation and MuScriptor inference), the current engine status and elapsed wall time.
- Neither pinned MuScriptor C++/WASM nor the native bridge guarantees meaningful percentage updates during blocking inference. **No fabricated %**, ETA or completed-note counts. Animated bar is explicitly indeterminate.
- UI responds in the same React app on browser and Windows; Windows native bridge audio/inference is NOT verified by web CI.
- MuScriptor model/weights/recognizer/pitch/velocity and pedal CC64 export are unchanged. No deployment to stable Preview/main before review.

QA: run `npm run build`, existing web MIDI/SoundFont/piano tests and independent Chromium transport/overlay smoke test; verify standalone Web on Cloudflare branch preview separately.
