# NOTIQ 5C — Manual sustain pedal CC64

- Branch: `feature/notiq-stage5c-manual-pedal-cc64`, based on Stage 5B PR #25.
- **Engine unchanged**: MuScriptor C++/WASM, native bridge, model weights, notes, velocities and original SoundFont player are not modified.
- Pedal is **off by default** and is never estimated from note outputs or audio.
- Set the song position using the time ruler, select all melodic tracks or a particular GM/pitch track, then click **Đạp** (127) or **Nhả** (0). Click a marker to remove it; **Xóa pedal** removes all edited CC64 markers.
- MIDI export writes controller CC64 messages in Type 1 separate tracks, and ZIP Kontakt stems preserve corresponding per-track events. No CC64 goes to GM drums (channel 10). An unmatched pedal-down is automatically released after the final note to prevent stuck sustain.
- Velocity and note timestamps are unchanged by editing pedal.
- **Important limitation:** Web SoundFont preview does NOT implement physical piano damper/sustain controller; CC64 is meant for playback in a DAW/VST that supports it. This does not restore the artist's original pedal, nor correct pitch mistakes.
- QA: run `npm run test:daw`, `npm run test:piano`, `npm run test:soundfont`, `npm run build` via the isolated GitHub workflow; manual browser QA should check ruler click, markers, per-track target and download.
- Do not merge to main or stable Preview until reviewed. No data files, GGUF, or audio should be committed.
