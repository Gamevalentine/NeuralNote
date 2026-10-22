# NOTIQ 5K — targeted quality repairs with reversible note edit and CC64 sampled sustain

Date: 22 October 2026. Base Stage5J browser branch. Draft PR #34. Does not change stable production.

## Investigation
NeuralNote original `Lib/Model/NoteEvent.h` uses `mergeOverlappingNotesWithSamePitch` after inference, merging the same instrument and pitch if note spans overlap. NOTIQ's shared MuScriptor bridge previously showed the raw notes directly. Repeated same-pitch overlaps can create doubled MIDI notes that interfere with sample player note-off semantics. But repeated attacks/rearticulations can be legitimate. Therefore **do not apply destructive filters automatically**.

NOTIQ previously recorded/exported MIDI CC64 but explicitly declared its SoundFont audition did not use them. The MIDI note-off timing itself was correct; only SoundFont listening ignored explicit sustain.

## Stage 5K implementation
- `web/src/noteQuality.ts`: optional linear group-by-program/pitch postprocessor (sort per bucket). Only truly overlapping note spans in same melodic instrument/pitch are combined; touching notes, different pitches/instruments, and drums stay. Extends end to max, keeps maximum amplitude, invalidates pitch bends when a span changes. It cannot fix wrong pitches/missed notes, so is NOT a new AI model.
- Existing MuScriptor and Transkun outputs saved untouched in `rawRecognitionNotes`, UI shows precise overlap count, **explicit button only** for `Gộp nốt chồng`, `Khôi phục nốt AI gốc`, and normal Undo. File change discards previous song snapshot. User edits retain undo semantics.
- When a matching user-provided **reference MIDI** is loaded, F1 before/after optional cleanup is computed by the Stage5I one-to-one pitch/onset matcher; negative F1 is explicitly flagged. This requires matched source recording; do not claim F1 improvement without it.
- `web/src/pedalPlayback.ts`: use **explicit** manual or inferred CC64 from stage5G output to extend the SoundFont sampled voice duration when pedal DOWN at the note-off time. Release at the first explicit CC64 OFF, bound to 8 seconds; no release means no fake held notes. Match track-specific `gm-<program>` or `pitch-<group>`, plus global `*`; track-specific simultaneous overrides global. Drums never sustain. The MIDI export continues to preserve original note-offs and CC64; neither acoustic damping/reverb nor pedal inference was implemented.
- Old misleading UI/DAW README that claimed CC64 was ignored in Web audition was updated.
- SoundFont player is the existing FluidR3_GM sample implementation; some samples decay naturally before the release. Physical listening on the user's machine remains unverified.

## Validation and limits
- Unit tests verify same-pitch overlap, different instruments, drums, retriggers, retained highest velocity, unchanged raw note arrays, CC64 explicit release timing, missing release, track-specific vs global events, 8-second bounds. GitHub Actions `notiq-stage5k-quality.yml` PASS on the tested version.
- Browser QA `notiq-stage5k-browser.yml` uses a REAL Chrome browser but **MOCKS the native AI notes** to deterministically test adding overlaps, explicit merge, restore of raw notes, CC64 persistence, MIDI export. It does not imply improved AI transcriptions. 
- Windows Portable QA `notiq-stage5k-windows.yml` reuses tested Stage5I native MuScriptor/Transkun binary adapters and changes React/ASAR only. Model weights not packaged; original user model files stay on chosen app drive.
- Cloudflare Pages experiment preview remains separate from stable production; only provide preview after confirmation. GitHub main stays untouched.
- Measured note accuracy on real piano/audio remains unknown until the user supplies paired audio and ground-truth MIDI. The algorithm can improve MIDI overlap hygiene but may hurt F1 for legitimate rapid repeated presses; hence optional.
- Remaining work: demonstrate a genuine real-music sample, investigate preproc/AI pitch false positives/missed notes using F1, and potentially implement true pedal damping based on a physically meaningful synth (not assumed in Stage5K).

All work free, no TinyFish, no CMD, no automatic E:/C: file movement, no production merge.
