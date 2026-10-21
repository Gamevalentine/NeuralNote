# NOTIQ 5E — Playback correction after real user report

Observed user screenshot: 815 notes / one GM Piano track / 04:29.84 source duration, transport says **Tạm dừng** while time displays **00:00.00**. Stage 5D QA covered original WAV playback only (mock bridge), *not* MIDI after successful 4-minute song transcription. Do not mislabel that as verified audio.

Fix: audible MIDI preview defaults to `Chỉ MIDI`, selected visibly in transport. MIDI uses its own AudioContext clock even when an original source file is loaded. `Âm gốc` and `Cả hai` remain explicit options, and media errors are shown. Avoid missing onsets from interval drift. Stop/Pause retain correct behavior.

No changes to MuScriptor model, recognition, detected pitches, note durations, estimated velocities, MIDI export or CC64.

Required QA: simulated full 4:29.84 original WAV and 815 actual MIDI note events in Chrome, test MIDI clock, pause/resume/stop and note scheduling. Inspect actual AudioBufferSource start calls; a button-only test is insufficient. Separately verify real SoundFont CDN if reachable, and record any network failures without claiming audible sustain or Kontakt.
