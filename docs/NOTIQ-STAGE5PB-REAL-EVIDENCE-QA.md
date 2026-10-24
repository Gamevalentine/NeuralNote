# NOTIQ 5P-B — Real full-song acceptance evidence (24 October 2026)

## Starting baseline
- Read `docs/NOTIQ-STAGE5P-SOURCE-RELEASE-QA.md` from `feature/notiq-stage5p-release-gates`.
- 5P-A source-built Windows #40088298166 PASS: 26/26 CPU/C++/QA + 71/71 Web/MIDI; x64 application, C++ native model loader and checkpoint self-test.
- The actual original MuScriptor Large v1 weights are **not bundled** (official size 2,739,142,176 bytes; pinned SHA256 `35a750fb1ab1e77195cdc2c0b9b4aeea2f4d59f11f729f02af9920c4854ef72e`). No 4–6 minute aligned real-audio/reference-MIDI pair was found in available project/conversation assets. Never invent real inference, metrics, ground truth or quality.
- Work only in `feature/notiq-stage5pb-real-audio-evidence` from `feature/notiq-stage5p-release-gates`. Do NOT merge to main without explicit approval.

## Implemented 5P-B — evidence capture and fail-closed audit
1. `desktop-preview/full-song-health.cjs` accepts opt-in read-only version 2 SHA256 fields in successful native run reports. Older version 1 reports remain readable but **cannot** satisfy 5P-B evidence.
2. `desktop-preview/main.cjs` fingerprints the actual decoded 16 kHz Float32 WAV bytes and actual returned native MIDI note objects with SHA256 and records the SHA of the **verified** selected GGUF model; only after the real native process completes successfully. JSON saves locally under `NOTIQ-Data/full-song-reports/notiq-5pb-*.json`, with actual 2/4/6 threads, checkpoint/resume flags, native process RAM/CPU, duration and output count. Does not log audio waveforms, MIDI events, file paths or stream personal data to a server.
3. `desktop-preview/acceptance-5pb.cjs`: accepts only version 2 **Large** full-song reports with valid actual native measurements and pinned model hash. Requires *two different* audio SHA256 fingerprints, duration 240–360 seconds each, and **three independently measured thread settings (2/4/6) for each song**. Rejects absent RAM instrumentation, high native memory ≥12 GiB, missing real resumed checkpoint or mismatched/absent MIDI reference evidence.
4. F1 gate computes **unrounded** TP/FP/FN comparisons against a separately supplied ground-truth MIDI, validates it relates to the same audio and recognized-note fingerprint, and refuses F1 regression greater than one absolute percentage point. Note fingerprint drift between thread settings is flagged for inspection, not silently accepted as identical.
5. Explicit human review required for playback, velocity, pedal and 5-second note boundaries; even with all evidence fields present, audit yields **`READY_FOR_HUMAN_REVIEW`** with `releaseApproved:false`, never auto-promotes to production. Otherwise returns **`HOLD`** with concrete blockers.
6. Electron IPC `notiq:5pb-evidence` is read-only and restricted to NOTIQ's own report directory; no arbitrary file paths supplied by web renderer. The existing 5M-D acceptance UI adds a **5P-B 'Đọc báo cáo đo thật trên máy'** button; it shows the measured native runs, hashes (short prefixes only), CPU threads, wall time, RAM, note count, and reasons HOLD, without CMD or uploads.
7. `desktop-preview/tests/acceptance-5pb.test.cjs`: 8 regression tests including synthetic/old report refusal, two-real-song + 2/4/6 matrix, missing measurements/hash, excessive RAM, checkpoint, absent paired reference, F1 >1pp, no false approval and note fingerprints. The simulated records are for **validating the gate logic only**, NOT inference benchmark evidence.
8. Updated source-only Windows 5P packaging workflow to include new tests and ASAR runtime adapter presence, and to continue keeping `QA_PREVIEW_ONLY` status.

## Acceptance still blocked
- Native Large 2.74GB must actually finish two independently sourced aligned 4–6 minute songs on the target 16GB Windows computer (or credible corresponding hardware for preliminary performance), recording RAM/CPU/times for 2/4/6 threads.
- Verify a real interrupted/resumed 5-second checkpoint yields correct full-song MIDI, no duplicate/lost boundary notes.
- Same-performance reference MIDI is required for objective F1/offset and a person must listen to velocity and CC64. **No such materials or target laptop runtime are accessible here at time of writing.**
- No model download to user's computer, no CMD, no production release, no `main` modification, and **no invitation to download a preview until the user-requested release gates are genuinely met**.

## CI status
- The 5P-B branch receives a Windows full-source CI to validate code, QA gates and packaging. See branch Actions runs; final result is recorded only after checking actual completed build and artifact hashes.


## 5P-B final code / packaging verification (24 October 2026)
- Source code commit **`a60dc8a8e2eb7b6835f62d1b7e04dec9a6b42a70`** passed genuine Windows GitHub Actions [run #40090071009](https://github.com/Gamevalentine/NeuralNote/actions/runs/40090071009), job **120860773346**, `completed/success`. GitHub job log: **35/35 native, desktop, health and false-PASS guard tests** plus **71/71 React/TypeScript/MIDI tests** PASS, Vite, MSVC-built fresh MuScriptor native C++, checkpoint self-test, Electron x64 source packaging and acceptance ASAR validator all PASS; no `##[error]`.
- Native / Electron preview passes the `NOTIQ_STAGE5PB_SOURCE_BUILD_GATED_PREVIEW_PASS` gate. `releaseApproved=false` intentionally remains in the resulting integrity manifest.
- Windows artifact **`NOTIQ-Stage5PB-EvidenceGated-Windows-QA`**, GitHub ID **12559085505**, ZIP size **130,757,788 bytes**. GitHub SHA-256 `08fc4c0c1236d4f1c1c57bff113ca4d737ffe1daf0cbd4e767443d56482d97a2`; expires **2026-10-31 11:32:06 UTC**.
- Independently downloaded actual ZIP from GitHub; local SHA-256 matches GitHub exactly. **77/77 ZIP entries** passed complete CRC validation. `NOTIQ-5P-INTEGRITY.json` included, status `QA_PREVIEW_ONLY`, `releaseApproved=false`, **14 ASAR runtime module requirements** verified by Windows CI. Locally recalculated SHA-256 for the full Windows EXE (**210,939,904 bytes**), fresh native MuScriptor x64 CLI (**1,777,664 bytes**), and app.asar (**5,456,810 bytes**); all three exactly matched the per-file hashes in the packaged integrity JSON.
- The last source code commit is under draft PR #48 into `feature/notiq-stage5p-release-gates` (not `main`). These checks prove source compilation, UI packaging and that the **acceptance validator refuses incomplete evidence**; they do **not** prove actual Large GGUF 4–6 minute inference, full-song human-aligned MIDI F1, end-to-end checkpoint resume during real music, or acoustic/pedal realism.
- No actual two-song reference corpus/model + target laptop job exists in this environment. Therefore **5P-B final release gate remains HOLD**. Next time real user-provided on-device measurements are available, use locally recorded report fingerprints rather than invented estimates. Do not notify the user that a completed public download is ready.
