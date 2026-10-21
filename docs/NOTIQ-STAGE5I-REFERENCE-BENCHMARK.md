# NOTIQ Stage 5I — Reference MIDI Benchmark and Mode Guidance

Project date: 22 Oct 2026. Branch: `feature/notiq-stage5i-reference-benchmark`, Draft PR #32 based on Stage 5H. Stable Web Preview/main/production unchanged.

## New user workflow
1. On Windows Portable, open a recording and install native MuScriptor and Transkun Piano V2 as in 5H.
2. Open **5I · Đo nốt đúng/sai bằng MIDI chuẩn**. Select Piano (GM0–7), multi-instrument (all pitched tracks), or Guided.
3. Optionally upload the *ground truth / reference* for **that exact performance** in a local .mid/.midi file, max 3 MB. This data is parsed locally with @tonejs/midi and is never uploaded to any backend. Drums/percussion are excluded from the note-scoring reference.
4. If audio and MIDI are shifted by a lead-in offset, set a **manual** alignment shift between -5 and +5 seconds (default zero). Do not auto-tune alignment to inflate score.
5. Run two native AI engines via the Stage5H same-WAV mechanism, then click **Chấm điểm hai AI với MIDI chuẩn**. Score each engine's output with exact MIDI pitch and start time +-100ms, one-to-one; unmatched AI events are false positives, unmatched reference events false negatives; compute Precision, Recall, F1, matched-note mean onset error. End-time error is reported *separately* from pitch/onset matches with accepted absolute end error <= max(100ms, 20% reference note duration).
6. Guided mode infers a scoring scope **only from the reference's GM program labels** (all Piano GM0–7 -> Piano, otherwise ensemble) and suggests one engine only when its reference F1 is >=2 percentage points better; close scores report no recommendation. Recommendations do not change MIDI unless explicitly accepted.
7. Existing Piano Roll edits, 5H agreement comparison, CC64 and Undo remain. No automatic merging, no unverified "AI improved" claim.

## What this does not do
- **No model retraining, weight replacement or real accuracy increase has been proven.** This exposes objective measurement so that a future optimization can be validated.
- Without a matched, correctly aligned and accurate reference MIDI, 5I cannot measure note correctness. A mere agreement between engines is not truth.
- MIDI GM instrument tagging, velocity/dynamics, pedal audio sustain quality are not being scored by F1. Piano mode intentionally scores only GM Piano program 0–7; other instrument programs and drum tracks are excluded for piano-scoped evaluation.
- A reference track might use a generic/default GM0 program even if the audio is multi-instrument; user must check its metadata and manually choose Ensemble when necessary.
- Real simultaneous multi-minute CPU benchmarks on the user's HP laptop have not yet been measured. Transkun Python only in Windows, not hosted on Cloudflare.

## Automated tests
- `.github/workflows/notiq-stage5i-benchmark-qa.yml`: strict TypeScript/Vite build, synthetic known-answer TP/FP/FN + MIDI parser tests and the existing 5H/MIDI/Piano/SoundFont unit tests.
- `.github/workflows/notiq-stage5i-browser.yml`: real Chromium with **mocked native recognizer outputs**, inject a two-note reference MIDI and check expected MuScriptor F1 50% vs Transkun F1 100%; ensure the user must click to accept recommended MIDI. This is a deterministic UI regression, not evidence of Transkun outperforming on actual music.
- `.github/workflows/notiq-stage5i-windows.yml`: repack latest React renderer onto Stage5H verified native MuScriptor/Transkun Windows Portable (no native inference code rewrite). Windows uses original binary and optional model installers, no CMD, no change to user's Windows C: drive.

## Acceptance
Run a **20–30 second piano-only audio recording** alongside the corresponding note-accurate reference .mid, compare engines, inspect FP/FN timestamps. Select the winning result if independently plausible. Repeat across multiple recordings before claiming improvement or merging the Draft PR. No paid services, TinyFish or production changes.
