# NOTIQ Stage 5N-B — Note accuracy audit, safe cleanup and precise manual timing

## Scope and baseline
- Based on Stage 5N-A: `feature/notiq-stage5n-audio-velocity` and the Stage 5M-D Windows CI PASS chain.
- No native MuScriptor model modifications. No weights added, no algorithm accuracy claims without independent ground-truth MIDI.
- `main` and stable release branches must remain untouched. Keep the stage under review until long-song/real-laptop checks.
- The goals are to identify *observed* wrong/extra/unmatched notes, prevent unsafe overlap merging, and make onset/offset editing precise to 10ms.

## Implemented: new `web/src/noteQuality5NB.ts`
- `previewNearExactDuplicates`: optional, reversible elimination of extremely close same-program+pitch MIDI duplicates: onset ≤12ms, note-off ≤25ms and velocity difference ≤0.06. Does not remove drums, notes with pitch bends or genuine retriggers separated by 40ms+. No changes to survivor velocity, duration, pitch or timing; original notes retained through undo.
- Conservative bound on near-simultaneous candidate scan prevents pathological O(n²) review. Handles 20,000 coincident candidates deterministically in unit tests.
- `diagnoseAgainstReference`: separate missing-reference, unmatched-prediction and excessive note-off errors, with up to eight seek-to-note examples per category. Uses exact pitch ±100ms, one-to-one greedy matching consistent with NOTIQ Stage 5I. Missing vs extra refers *only* to independently supplied MIDI reference; no AI inference of missing pitches.
- `cleanupPreservesReference`: fail-closed gate that compares **raw** F1 from integer TP/FP/FN plus matching onset and note-off metrics; rejects cleanups that would sacrifice matched notes or worsen errors beyond 2ms. Previously available broad same-pitch overlap merge is also checked against this gate when a reference is loaded.
- Without an actual corresponding reference MIDI, near-exact dedupe requires explicit user click; the application does not call that an accuracy improvement.

## Implemented: timing correction and UI
- `pianoEdit.nudgeNoteBoundary`: user-selected note-on or note-off ±10ms, independent from the coarser 125ms mouse snapping. Note-on move keeps note-off fixed; note-off move keeps note-on fixed. 10ms minimum duration; bounded near recording ends; pitch/other notes unmodified. Stores the change via the existing Undo history.
- UI `Chất lượng MIDI → 5N-B · Kiểm tra nốt đúng/sai` shows candidate duplicate count, before/after F1 with reference, mismatch diagnosis and clickable seek actions. Four timing buttons appear for selected Piano Roll note.
- No automatic injection of reference notes into NOTIQ output, nor inferred CC64 pedal/isolated microphone dynamics.

## Genuine Windows CI and package QA (2026-10-24)
- Latest verified source SHA **`c35b599606ec16b23040f211e6cb654f0de64171`**.
- GitHub Windows Actions run [#40073681268](https://github.com/Gamevalentine/NeuralNote/actions/runs/40073681268): **completed/success**, job **120812370014**. Decoded Windows log shows **15/15 native/CPU/CLI tests**, **53/53 web/MIDI/TypeScript tests** PASS, successful Vite build, verified 5M-C native checkpoint self-test, successful Electron ASAR repack. `NOTIQ_STAGE5NB_WINDOWS_NOTE_QA_PASS` emitted; no `##[error]` lines.
- GitHub artifact **#12551693578**, `NOTIQ-Stage5NB-NoteAccuracy-Windows-Preview`, size **130,715,231 bytes**, SHA256 **128b95cd81a292e032de26c2392fd182763365f1f2a3c731b8f11cf691331436**. Expires **2026-10-31 07:20:36 UTC**.
- Independently downloaded artifact and verified byte size and SHA256, tested **all 87 ZIP entries** (CRC no errors), checked Windows x64 PE headers (0x8664) for executable and native CLI, verified `resources/app.asar` (5,317,465 bytes) and `README-STAGE5NB.txt`. The app.asar includes the 5N-B review and 10ms timing UI strings. This verifies package integrity, not GUI interaction on a user's Windows device.
- The artifact has the Windows app and MuScriptor CLI but **does not embed Large 2.74GB GGUF weights**. The core recognition model is unchanged.

## Release blockers / next stage
- Test the full 4-6 minute song on the target Windows CPU/16GB RAM system with the original 2.74GB model; verify no hangs or abnormal sustained RAM.
- Use a real same-performance reference MIDI to measure F1, suspected missing notes, false positives, onset/offset alignment and inspect 5-second chunk boundaries.
- Subjectively A/B note velocity and manual CC64 pedal with actual piano audio. 5N-B does not guarantee musical improvement solely from reference-aware *reporting* and conservative duplicate elimination.
- No user download recommendation, no production merge until these objective and listening gates pass.
