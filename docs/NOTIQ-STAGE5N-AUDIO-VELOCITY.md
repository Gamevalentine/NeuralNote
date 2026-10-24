# NOTIQ Stage 5N — Audio-grounded optional velocity

## Baseline and scope

- This feature branch is based on the 5M-D feature branch; **do not modify or merge into main** before review.
- On 2026-10-24, artifact `12551172364` from real Windows CI run `40070801945` was downloaded into an isolated QA environment. SHA-256 checked locally against GitHub: `8a8ed2964a36ee8aaf6986fc30c8bdce5935b7680fe5080efa351e500796240a`. The ZIP contains 85 entries, all CRC checks PASS (`ZipFile.testzip() == None`), includes `NOTIQ-Stage5-FullSong.exe`, `resources/bridge-bin/notiq-muscriptor-cli.exe`, `resources/app.asar`, and `README-STAGE5M-D.txt`. This is archive integrity, not an actual Windows GUI execution.
- MuScriptor's native `notiq-native/main.cpp` writes fixed `amplitude=0.7874015748` for every recognized note. The upstream `msl::Note` format explicitly states the model **does not predict velocity**. A bigger checkpoint alone cannot recover key pressure or CC64.

## 5N-A implementation (opt-in, reversible)

- New pure module `web/src/velocityFromAudio.ts` analyzes a 20ms RMS envelope of the **original local audio**, sampling at no more than roughly 8 kHz per audio channel. For each eligible MIDI note, it estimates relative loudness near the onset; normalization is **within each MIDI track/pitch group** using robust 10th/90th quantiles. Each eligible group's audio dynamics must exceed a 1.35 ratio.
- Writes values only for melodic tracks with a flat starting amplitude and at least six measurable notes. Preserves pitch, start, duration, note order, instrument, drum notes, original expressive velocities and CC64. Does not invent dynamics from silence or flat input.
- The new NOTIQ GUI action `5N · Ước lượng mạnh–nhẹ từ âm thanh` decodes the selected audio locally; it checks that the selection and notes have not changed during async decoding, then commits velocity through the existing undo history. No automatic changes on load/inference or uploads.
- This is a **mix-energy proxy**, not per-note source separation, genuine pianist key-force estimation or automatic pedal inference. The user must A/B by listening, and it may be unsuitable for busy full-band recordings.
- New `web/tests/velocity-from-audio.test.mts` covers varying loudness, unchanged timing/pitch, uniform energy, drums, existing expressive velocities, stereo, silence, invalid data, and actual MIDI note-on velocity export round trip. The first five pure algorithm tests ran as 5/5 PASS in isolated V8 with type-only annotations removed. A synthetic 80,000-note stress check completed without an argument-spread limit error in 124 ms. **These are NOT full official TypeScript, MIDI export, or Windows tests**. The new integrated MIDI export test requires actual dependency-backed Node/Vite CI.

## Required acceptance before release

1. Run the full Stage 5N TypeScript/Vite build and `node --experimental-strip-types --test` suite with installed `@tonejs/midi`/fflate dependencies on a Windows runner.
2. Compare actual reference clips with original fixed-velocity output, then A/B sound with opt-in velocity; ensure no measurable note F1 regression (note events must remain unchanged).
3. Verify the Windows package contains 5N UI and all unchanged native binaries; download and CRC/SHA validate the produced artifact.
4. Test on the target laptop with the actual Large 2.74 GB model and a full-length song, plus manual CC64 pedal checks. No user download recommendation or production merge before meaningful verification.
