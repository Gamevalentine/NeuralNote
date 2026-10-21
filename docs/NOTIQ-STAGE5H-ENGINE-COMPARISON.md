# NOTIQ Stage 5H — Dual Engine Comparison

Project date 22 Oct 2026. Branch `feature/notiq-stage5h-dual-engine-comparison`. Draft PR #31, based on Stage 5G Piano V2. **Not merged into main, production, or stable preview.**

## What 5H does
- **Windows Portable only:** requires installed MuScriptor Small or Large plus installed Transkun V2 CPU.
- From a loaded audio file, user explicitly chooses **So sánh MuScriptor ↔ Transkun V2**. One shared 16kHz/mono Float32 WAV is passed sequentially through the existing native bridges. Both outputs stay separate.
- A deterministic one-to-one matcher pairs notes by **exact MIDI pitch** and **onset difference <=100ms**. Duration differences are reported independently and never used to label a note erroneous. Repeated notes are not double-counted. Matching uses per-pitch, sorted onset windows rather than an unbounded all-pairs search.
- UI reports paired notes, MuScriptor-only notes, Transkun-only notes, mean absolute onset and duration difference for pairs. Read-only colored markers show these categories in the Piano Roll (max 3,500 marks to bound DOM). Buttons in the panel seek to disagreement times.
- **Agreement is not accuracy.** Without an aligned ground-truth MIDI neither single-model note is automatically declared right or wrong. MuScriptor may identify non-piano instruments; these are not filtered out or auto-merged in 5H.
- The original Piano Roll and CC64 are not changed during inference or mere model switch. User explicitly chooses `Dùng MuScriptor`, `Dùng Transkun V2`, or `Khôi phục MIDI trước 5H`. The restore button brings back notes and prior CC64 lane; note changes enter Undo history. Reopening an audio file invalidates old comparison.
- No model auto-install, no CC64 invention, no new AI network hosting, no expensive background inference without a click. No edits to MuScriptor/Transkun inference engines, weights or licenses.

## Reproducible QA
- TypeScript/Vite build + 6 matcher unit tests and MIDI/Piano/SoundFont regressions: [GitHub Actions #39691334260](https://github.com/Gamevalentine/NeuralNote/actions/runs/39691334260), **PASS**.
- Chrome UI workflow [#39691334288](https://github.com/Gamevalentine/NeuralNote/actions/runs/39691334288), **PASS** with clearly **mocked AI bridge data**. It verified byte-identical WAV delivered to both independent bridge APIs; single shared note, exclusive note for each, present active MIDI unaffected during comparison, explicit MuScriptor selection and restoration of original Piano notes and CC64. A first QA run failed because restoration returned pedal track filter to `*`, hiding restored `gm-0` pedal points; fixed to select the existing CC64 track and reran PASS.
- Windows Portable [#39691334333](https://github.com/Gamevalentine/NeuralNote/actions/runs/39691334333), **PASS**: builds latest renderer and packs into verified Stage5G bundle, MuScriptor original native `--self-test` PASS, original Transkun V2 Python runtime remains opt-in and unchanged. [Windows ZIP artifact #12388767684](https://github.com/Gamevalentine/NeuralNote/actions/runs/39691334333/artifacts/12388767684) (~130.7MB, GitHub expires 28 Oct). Direct file in conversation `NOTIQ-Stage5H-Dual-AI-Windows.zip` passed `zipfile.testzip`, 79 entries, contains `NOTIQ-Stage5-FullSong.exe`, native bridge executable, `resources/app.asar`, README-STAGE5H.
- Prior Stage5G **actual Transkun V2/PyTorch Windows installer + 2-second inference**: [#39689229123](https://github.com/Gamevalentine/NeuralNote/actions/runs/39689229123) PASS. This is distinct from 5H's deterministic mocked UI test.

## Explicit limitations
- No ground-truth comparison on user's piano songs yet; natively matched notes are not independently verified correct. The Windows Chrome UI bridge in #39691334288 is simulated; no live simultaneous 4-minute A/B on user's laptop has been performed.
- CPU-only Large on an i5/16GB machine may be very slow. No true progress ETA is promised. Neither Kontakt/audio sustain quality nor auto pedal rendering was tested in Stage5H.
- Web/Cloudflare supports MuScriptor Small WASM; V2 Python dual inference is not running as a hosted browser service.

## User acceptance procedure
1. Extract entire ZIP on E: (or chosen drive), open `NOTIQ-Stage5-FullSong.exe`, no CMD.
2. Ensure Small/Large MuScriptor checkpoint is loaded and install Transkun V2 Piano if not already installed. Both must be available.
3. Open a **20–30 second piano-only** recording first, click `So sánh MuScriptor ↔ Transkun V2`. View agreement figures and click disagreement timestamps.
4. Select one candidate MIDI or restore the prior MIDI; export from current Piano Roll. A reference MIDI/audio pair is still needed to benchmark actual pitch/onset errors.
