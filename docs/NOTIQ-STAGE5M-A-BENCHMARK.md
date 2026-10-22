# NOTIQ Stage 5M-A — Reproducible MuScriptor Windows CPU Benchmark

Date: 23 October 2026. Parent: Stage5L Large progress/cancel, PR #35. Experimental branch `feature/notiq-stage5m-a-cpu-benchmark`. Stable web/production remain unchanged.

## Why
On the user's HP 240 G8 (i5-1135G7, 16 GB RAM), a 4m58 piano audio with official MuScriptor Large 2.74 GB reported progress 20% → 21% despite >21 minutes elapsed. Initial Windows Task Manager showed ~12% process CPU and ~4 GiB working set. Progress 20% is the completed model-loading marker in the native CLI, not 20% of entire transcription. Large is CPU-only in this app and currently compiled with `n_threads=2`. No evidence yet proves that increasing threads or using a bigger GGUF increases accuracy.

## Implemented 5M-A
- Windows-only local UI: `AI 5M-A · Đo tốc độ CPU` on a loaded audio file. Explicit single clip length 20, 30 or 60 seconds, start offset selected in seconds (default 0). Model Small/Large is the one the user already selected and downloaded. **Never automatically run three costly benchmarks or a 5-minute full song.**
- Converts source audio to 16kHz mono float32 WAV using existing NOTIQ decoder once, measures this preparation separately, then validated native `makeClip` extracts exactly the requested PCM frames. No untrusted file path, command, user-provided shell argument, or third-party service is passed to the CLI.
- Uses verified original MuScriptor Windows executable and pinned GGUF. Measures SHA256 time, WAV write time, model load time (genuine `PROGRESS 20` marker), inference+output time, total native process runtime, number of events. C++ weights, `n_threads=2`, pitch algorithms and native CLI have not been modified.
- Reads *only the native CLI process* resource data using built-in Windows PowerShell `Get-Process`, at ~4-second intervals, not Electron RAM. Reports peak Windows `PeakWorkingSet64`, average CPU utilization across logical processors computed from process cumulative CPU time between samples, and number of usable samples. Missing samples produce `null` / "Chưa đo được", **never invented zero or guessed CPU**. Sampling adds some measurement overhead.
- Explicit Cancel uses Stage5L `notiq:cancel-transcription`; benchmark and normal inference cannot run concurrently. Model switching, file loading and audio playback blocked/stopped during benchmark. No changes to editable MIDI or CC64.
- Successful run stores **only diagnostic metrics, not the audio or transcribed notes** as JSON in `NOTIQ-Data/benchmarks` next to portable executable (E: if unpacked on E:). Input/output temp WAV and MIDI JSON are removed on completion/failure/cancel. No file is sent to a server.
- **This stage does not accelerate Large.** It establishes measurable baseline for 5M-B thread trials and 5M-C chunking. A clip's processing time cannot be safely extrapolated to the full song; GGUF model load is per run and different sections may vary.

## QA / acceptance
- `.github/workflows/notiq-stage5m-a-windows.yml` on windows-latest: Node WAV PCM clip framing and rejection fixtures, native progress parser, Windows Get-Process **real** OS metric sample, Electron source syntax and TypeScript Vite build; 5I/5K regression; existing MuScriptor native `--self-test`, Electron ASAR packaged with 5M-A. No Large 2.74 GB checkpoint included in ZIP.
- Real model and 4-minute audio inference on user's computer is **not** part of CI: user acceptance should test 20s (before 30 or 60) and provide result JSON; verify CPU/RAM/phase times, test the same clip Small and Large, avoid 5-minute reruns. Do not merge until data proves measurable wins for any proposed tuning.
- If CPU or peak memory metrics unavailable on a particular Windows machine, show unavailable; sampling is best effort and should not stop AI.
- All actions free, GitHub only, no CMD requested of user, no TinyFish, no paid cloud, no production merge.

## Follow-up gate for 5M-B
Compare exactly the **same WAV clip** with same checkpoint and same offset, trying 2/4/6 threads on separately QA'd branches, warm/cold cache controlled, repeated runs. Evaluate elapsed inference time vs peak RAM and inference note quality against true reference MIDI. Do not automatically increase threads without measurement.
