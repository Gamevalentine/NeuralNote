# NOTIQ Stage 5N-D — CC64 Pedal & SoundFont sustain acceptance

## Technical log and baseline
- Implemented from the verified 5N-C draft head, after reading `docs/NOTIQ-STAGE5NC-VELOCITY-QA.md`.
- Main, production release and upstream native MuScriptor model were **not changed**.
- This is not AI pedal transcription: MuScriptor generates notes with **no** predicted CC64. Sustain changes require user edits or a separately available Piano V2 source; never silently synthesize claims of recovered pianist technique.

## Implementation (24 October 2026)
- `web/src/pedal.ts`: CC64 `effectivePedalEvents` produces a deterministic monotonic timeline for all melodic tracks, with track-specific event taking priority at a simultaneous global event (rounded to 1 ms). Rejects invalid events, removes redundant repeats. Same resolver used for MIDI export and sample sustain. `eventsForPedalTrack` scales to large tracks without spreading arrays and auto-closes an unfinished pedal after the final MIDI note; percussion channel never receives CC64.
- New pure `addPedalSpan` produces a user-chosen bounded down/up pair (0.5, 1, 2 sec via UI), refuses overlapping starts or invalid duration. `shiftPedalPoint` allows exact ±10 ms adjustments without crossing same-track neighboring points. `pedalDownAt` reports status at the current playhead.
- `web/src/pedalPlayback.ts` now imports the shared resolver with explicit `.ts` extension supported by both Vite and Node 22 built-in TypeScript stripping. SoundFont holds a sample up to the next **explicit** CC64 release (≤8 s), without extending original MIDI note-offs or simulating sympathetic/damper resonance. A dangling pedal on without off does not cause infinite sample hold.
- `web/src/App.tsx`: status indicator, bounded down/up insertion, selectable lane markers, ±10ms editing, delete selected, independent pedal Undo/Redo, clear, and track picker. User editing stays optional and separate from the existing Ctrl+Z note editor; pedal history is reset on song and engine-result changes, avoiding stale-pedal undo across files.
- `web/src/piano-editor.css`: selected CC64 marker and readable compact toolbar controls.
- `web/tests/pedal-5nd.test.mts`: 8 new unit/integration tests for span validity, track-specific priority over global at identical timestamps, SoundFont vs MIDI consistency, original note-off retention, safe missing pedal-off, no drums, shift bounds, Kontakt multitrack/stems, and 70,000-note safety. Existing tests are retained.

## Real Windows CI
- First Windows CI run [#40075222024](https://github.com/Gamevalentine/NeuralNote/actions/runs/40075222024) failed **after successful TypeScript/Vite build** because a new runtime import omitted the explicit `.ts` suffix in `pedalPlayback.ts`. Read Windows logs and fixed just that import at commit `c01b7b04d22491c39e50866e7d7cada03836b138`, without weakening tests.
- Final Windows CI run [#40075341405](https://github.com/Gamevalentine/NeuralNote/actions/runs/40075341405) on SHA `c01b7b04d22491c39e50866e7d7cada03836b138`: **completed/success**, job ID `120817364453`.
- Read full Windows job logs: **15/15 native/CPU/CLI** and **71/71 web/TypeScript/MIDI** tests PASS; Vite build, real native C++ checkpoint self-test and Electron repack PASS. Marker `NOTIQ_STAGE5ND_WINDOWS_CC64_PACK_PASS` appeared, no `##[error]`.
- Artifact `NOTIQ-Stage5ND-PedalCC64-Windows-Preview`, GitHub ID **12552163974**, **130,719,350 bytes**, SHA256 `ab81e4fa9fd5d89dcb014cad87b3fd9ce61db710ccd6d13e1b3efa59c1ea3754`; available until **2026-10-31 07:45:45 UTC**.
- Independently downloaded the actual ZIP into QA container; **locally computed SHA-256 equals GitHub hash**, 89 ZIP entries and **all 89 CRC validations PASS**. Required packaged components present: `NOTIQ-Stage5-FullSong.exe` (210,939,904 bytes), `resources/bridge-bin/notiq-muscriptor-cli.exe` (1,778,176 bytes), `resources/app.asar` (5,326,104 bytes), `README-STAGE5ND.txt`. Both executables have genuine Windows x64 PE machine 0x8664; compiled ASAR includes `notiq-pedal-span`, `Thêm khoảng đạp`, and `Hoàn tác pedal` UI labels.
- This establishes **source unit/integration test correctness, Windows packaging and ZIP integrity**, but not an actual Windows GUI or high-quality audio/pedal realism on the target user's laptop.

## Next acceptance gates: Stage 5N-E and 5P
1. Profile full songs, model Large 2.74GB, 2/4/6 threads, peak process RAM and checkpoint continuity on the target Windows i5/16GB hardware; avoid hangs on long audio.
2. Validate matched reference MIDI score/F1 and manual CC64 waveform/listening A/B on piano audio, including release tails and repeat/retrigger notes.
3. Treat SoundFont as a sample-duration approximation; genuine acoustic damper resonance or velocity-sampled Kontakt instruments require a real instrument renderer, not merely longer note durations.
4. Keep 5N-D PR draft and no `main` merges or user-download recommendation until real full-song acceptance is complete.
