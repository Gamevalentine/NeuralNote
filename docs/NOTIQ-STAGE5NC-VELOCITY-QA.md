# NOTIQ Stage 5N-C — Per-note MIDI velocity and SoundFont A/B

## Baseline, scope, decisions
- Branch `feature/notiq-stage5nc-note-velocity`, based on the previously checked `feature/notiq-stage5nb-note-accuracy` draft PR #43. Do not modify `main` or merge draft branches without user approval.
- Read and reconciled `docs/NOTIQ-STAGE5NB-NOTE-QUALITY.md` before implementing.
- Preserve MuScriptor's original C++ model and inference; no changes to MIDI pitch, onset, offset, note order, instrument or CC64. MuScriptor native currently emits flat amplitude 100/127 because the AI model does **not** predict true velocity.
- No requirement for extra paid services, CMD or downloads on the user's machine at this stage.

## Implemented
1. `web/src/velocityEditor.ts`: MIDI velocity 1–127 helpers, validation, per-note set/nudge and normalized SoundFont preview gain. Default MuScriptor amplitude 100/127 maps to gain 1x. The previously hard-clipped 0.3–1.15 multiplier that suppressed soft/high dynamics was replaced by the full quantized 1–127 ratio in **both** live MIDI playback and one-note audition.
2. `web/src/App.tsx`: a 5N-C panel inside `Chất lượng MIDI`, with selected-note slider, ±5 buttons, explicit Apply and two A/B buttons (`Nghe trước` / `Nghe sau`). The slider is a draft state: moving it does not modify saved notes or fill Undo history; Apply creates one checkpoint via the existing `commitNotes`. The baseline from the first edit of a selected note is retained for A/B, guarded by note identity (index/pitch/program/onset/duration) and reset on selection change. Both previews call the existing SoundFont player with the same instrument/track/master volumes, while note timing, programs and CC64 remain untouched. Edits/preview disabled during active recognition or playback.
3. Existing Piano Roll note tooltips now display note velocity in genuine MIDI units.
4. `web/tests/velocity-editor-5nc.test.mts`: 5 new tests for MIDI 1–127 normalization and invalid inputs; note immutability and exact one-note changes; clipping at limits; normalized preview dynamics (1,100,127); actual @tonejs/midi Type 1 and Kontakt track-stem export round trips. The existing `web/tests/piano-edit.test.mts` is now also run explicitly in CI.
5. `web/src/note-quality.css`: responsive velocity editor, no overlay obstructing tracks.

## Real Windows CI and artifact integrity (2026-10-24)
- Source SHA `56b8a01936a8fa3b6fb6ae0b2c9f14c7becb72ab`.
- [Windows GitHub Actions #40074265016](https://github.com/Gamevalentine/NeuralNote/actions/runs/40074265016) completed **success**, job ID `120814164993`.
- Read real job logs: **15/15** native/CPU/CLI tests PASS and **63/63** Web/React/TypeScript/MIDI tests PASS; Vite/TS build, original 5M-C native checkpoint self-test, Electron repack and artifact upload all completed. Printed `NOTIQ_STAGE5NC_WINDOWS_VELOCITY_PACK_PASS`. No `##[error]` lines. One nonfatal GitHub Actions Node.js 20 deprecation warning from v4 actions.
- GitHub artifact `NOTIQ-Stage5NC-PerNoteVelocity-Windows-Preview`, ID **12552238684**, **130,716,982 bytes**, SHA256 `d413a5a6b0e655d038a4a589d53d56650782314cc036c74842a13f511a9b1e71`, expiring **2026-10-31 07:29:32 UTC**.
- The artifact was **independently downloaded** into isolated QA container. Local SHA256 exactly matched GitHub's digest; **88 ZIP entries** passed full CRC validation. The archive contains `NOTIQ-Stage5-FullSong.exe` (210,939,904 bytes), `resources/bridge-bin/notiq-muscriptor-cli.exe` (1,778,176 bytes), `resources/app.asar` (5,321,277 bytes) and `README-STAGE5NC.txt`. Both Windows .exe files contain x64 PE headers. Extracted app.asar raw bytes include compiled `notiq-velocity-5nc` slider, `5N-C · Velocity từng nốt`, `Nghe trước` and `Nghe sau` labels.

## Important limits and next stage
- Tests confirm **correct MIDI encoding and gain mapping** and that Windows packaging contains the UI. They do **not** prove realistic piano tone, physical key attack, velocity-switched sample layers, separate instrument dynamics, or the user's subjective musical expectations. SoundFont playback scales gain only.
- NOTIQ still needs full-song Large 2.74GB tests on the target Windows i5/16GB machine with a real reference MIDI and assessment of note precision, pedal and stability. No 5N-C package should be recommended as a finished user download before these real-audio acceptance checks.
- Next planned 5N-D: detailed CC64 pedal UX and playback consistency; 5N-E/5P: full-song Windows acceptance and release gating. Draft PR only; `main` unchanged.
