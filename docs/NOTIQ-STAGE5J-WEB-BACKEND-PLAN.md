# NOTIQ Stage 5J — Browser Reference Evaluation + Server AI Architecture (Preview Only)

Date 22 October 2026. Parent: Stage5I Windows `feature/notiq-stage5i-reference-benchmark`.

## 5J-A: what actually runs in the browser now
- The preexisting MuScriptor **Small 209 MB C++ WebAssembly** remains the ONLY in-browser transcription model, with existing official GGUF/SHA checks. No Transkun Python, Large weights, GPU hosting, audio upload or fake recognition is added.
- Once real WebAssembly transcription produces notes, the Web now exposes the local Stage5I style **reference MIDI** evaluation: exact MIDI pitch / note onset ±100 ms, TP/FP/FN, Precision/Recall/F1, onset and release timing summaries. It uses the currently editable notes, which may have been adjusted by hand, and labels this clearly.
- `WebBenchmarkPanel` offers a **Piano / Ensemble / reference-guided scoring scope**, optional manual reference offset ±5 s, one matching reference MIDI (.mid/.midi <=3 MB), optional second MIDI imported from the user's own files (e.g. separately exported by Transkun V2 Windows). The optional file is NOT advertised as live server Transkun inference.
- Both MIDI files are parsed and evaluated in the browser only, without any upload to server or remote AI. No automatic replacement/merging of MIDI or CC64. Without a reference there is no claim of note accuracy; without recognized MIDI there is no F1.
- Existing Windows Stage5I evaluation and native Transkun/MuScriptor workflow remain unchanged. Small WASM remains the Web inference default.
- Fixed stale UI labeling that incorrectly claimed web recognition requires Windows. No credentials or monetized service enabled.

## 5J-B: server AI readiness, NOT a running server
- `notiq-ai-core/remote/protocol.mjs` defines pure validation of a prospective remote inference job: explicit opt-in consent, WAV-only normalized request, maximum 200 MB/15 min, engine whitelist `muscriptor-large` or `transkun-v2-piano`, job statuses and permitted transitions. This is tested offline with Node. It does **not create a server, upload content, launch an HTTP listener, provision a GPU or connect the deployed site to remote inference**.
- Proposed private backend API (not yet implemented): a request to authorize a short-lived upload and create a job; client PUTs WAV to signed per-job location; client reads job status, cancels job; server returns bounded JSON notes/CC64; ephemeral objects auto-delete after retention. Never expose GPU credentials or a storage bucket secret in the browser. Add authentication, per-user authorization, rate limits, cost budget and automatic cleanup **before** enabling this.
- Hosting requirements for serving MuScriptor Large (2.74 GB GGUF + about 1.5 GB KV cache) and Transkun V2 PyTorch cannot be met by a generic Cloudflare Pages static deployment or ordinary Worker RAM budget. An explicitly approved, measured CPU/GPU backend is required; no payment or production changes are permitted without owner approval.
- Request consent UX and terms/license review must precede any server processing: MuScriptor GGUF currently CC BY-NC 4.0 (non-commercial). Do not silently commercialize weights. Transkun MIT alone does not clear MuScriptor usage.
- The UI must label **Available only on Windows** until backend has real inference QA; do not show a working cloud model selector without a connected real server.

## 5J-C: acceptance test gates before merging
1. TypeScript/Vite build PASS. Existing 5I reference, 5H matching, DAW/Piano/SoundFont regressions PASS.
2. Unit tests on genuine MIDI bytes: single Web score, imported candidate A/B, Piano-vs-Ensemble scoring scope, no-fake-scores, manual alignment.
3. Chrome verifies 5J UI file inputs and transparent message when model output absent; measure actual in-browser GGUF inference separately (existing upstream known real WASM tests do not prove the new 5J panel improves recognition).
4. Preview deployed on an isolated Cloudflare branch with proper cross-origin isolation, no changes to stable site. Only send a link after Cloudflare explicitly confirms deployment and smoke test runs against it.
5. Approval from user after testing a 20–30 second paired audio + reference MIDI. A web scoring UI alone DOES NOT improve or retrain the AI model.

## Rollback
Only branch-specific React files, web styles, tests and inert server protocol are added/changed. No C++ model, PyTorch, Windows Electron native bridge, CC64 inference or stable Cloudflare site is modified. Discard branch to restore Stage5I.
