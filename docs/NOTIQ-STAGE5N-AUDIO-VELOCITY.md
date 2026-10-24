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


## Real Windows CI and archive verification — 24 October 2026

- On commit `f85379ac18f78a3cce94fdbc791dcc62f740c433`, the registered Windows runner executed [run #40072436002](https://github.com/Gamevalentine/NeuralNote/actions/runs/40072436002): **completed / success**, job `120808579040`.
- Read Windows logs: **15/15 CPU/native/CLI tests PASS**, **40/40 web/TypeScript/MIDI tests PASS**, including the new Stage 5N velocity-to-real-MIDI note-on regression. Vite/React build succeeded; Windows native checkpoint self-test and Electron ASAR pack stage succeeded. Logged marker `NOTIQ_STAGE5N_WINDOWS_VELOCITY_PACK_PASS`; no `##[error]`.
- Official Windows artifact: `NOTIQ-Stage5N-AudioVelocity-Windows-Preview`, ID **12551359885**, size **130,711,510 bytes**, SHA256 **bb5638625a91852e50cfd0cbe435ebe94be346c9671d1f1eecc4b76813a606f6**, available in the GitHub CI run until **2026-10-31 07:01:25 UTC**.
- Independently downloaded **this actual 5N ZIP**, calculated SHA256 locally and confirmed an exact match to the GitHub artifact digest. `zipfile.testzip()` reported **no CRC failure** across **86** entries. Required files present: `NOTIQ-Stage5-FullSong.exe` (210,939,904 bytes), `resources/bridge-bin/notiq-muscriptor-cli.exe` (1,778,176 bytes), `resources/app.asar` (5,307,420 bytes) and `README-STAGE5N.txt`. Both Windows EXEs have genuine x64 PE headers (MZ, PE, machine 0x8664).
- Independently parsed `app.asar` contents: includes packaged web `www/assets/index-DohKh0KN.js` with the actual Stage 5N velocity user interface label. The packaged app uses the unchanged native MuScriptor CLI and externally installed GGUF checkpoints.
- **QA boundary:** Stage 5N static logic, Windows build, MIDI-note-on export unit test and ZIP integrity **PASS**. Still **NOT** verified on the target Windows laptop with real 4-minute+ music, with the Large GGUF weights, nor independently rated for perceptual expressiveness, pedal and pitch accuracy. It is a validated *preview*, not a finished user-approved production version; avoid telling the user to download before full-song acceptance.
- Stage 5N PR #42 stays draft against 5M-D; `main` and the last accepted Stage 5M-D source remain untouched by 5N changes. This documentation-only note is deliberately marked `[skip ci]` to avoid wasting another free Windows runner/artifact storage allotment.
