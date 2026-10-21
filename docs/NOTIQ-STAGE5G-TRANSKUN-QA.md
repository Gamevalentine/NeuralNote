# NOTIQ 5G — Transkun V2 Piano (experimental, Windows only)

Date: 22 Oct 2026. Parent: Stage 5F MuScriptor Small/Large. Draft PR #30.
No production merge or stable website change.

## Implemented
- A **separate** Transkun V2 (PyPI package 2.0.1, MIT) engine in the native Windows bridge, installed only after an explicit user click.
- Pinned Astral `uv` 0.13.4 ZIP and SHA256, Python 3.11, CPU PyTorch 2.5.1, torchaudio 2.5.1, Transkun 2.0.1. Runtime and caches under `NOTIQ-Data/transkun-v2` next to EXE on the chosen drive. No shell/CMD interaction, no global Python or model automatically installed.
- Piano float32/16kHz/mono WAV is sent only to independent Python runner. Actual V2 package model is loaded in a native subprocess. Output has its **own** `transkun-v2` schema for piano notes, velocity, onset/offset and any actual CC64. The UI only replaces previous notes after validation; manual MIDI edits and the original MuScriptor checkpoint code are untouched by merely selecting the engine.
- Web page/Cloudflare DOES NOT run Python or Transkun. Native Windows only. No AI host server is included.
- The existing MIDI export and Piano Roll are reused, with pedal lane automatically targeting the Piano GM track.

## Verified
- Linux **real** Transkun V2 CPU checkpoint and inference smoke: [run 39688780626](https://github.com/Gamevalentine/NeuralNote/actions/runs/39688780626) PASS. Synthetic 2s sound produced 0 notes; this proves model loading and execution, NOT accuracy.
- Windows **real** on-device-style installer and inference: [run 39689229123](https://github.com/Gamevalentine/NeuralNote/actions/runs/39689229123) PASS. It downloaded the pinned tool with hash verification, created isolated Python environment, installed upstream Transkun V2/PyTorch and successfully ran V2 CPU inference on a synthetic sample. First attempt failed because ZIP uncompressed uv.exe exceeded too-strict bound; corrected the bound and reran PASS.
- Windows Electron portable packing: [run 39689294931](https://github.com/Gamevalentine/NeuralNote/actions/runs/39689294931) PASS. Original MuScriptor CLI self-test still PASS, TypeScript and old MIDI/Piano QA PASS. No Python runtime or 56MB V2 checkpoint prebundled. User-facing artifact: [#12387607099](https://github.com/Gamevalentine/NeuralNote/actions/runs/39689294931/artifacts/12387607099).
- Chrome UI/IPC mock test (clearly NOT actual piano transcription): [run 39689405111](https://github.com/Gamevalentine/NeuralNote/actions/runs/39689405111) PASS for engine separation, notes, CC64, MIDI export, preserving existing notes on engine switch.

## Not verified
- The user's own 4-minute piano accuracy versus MuScriptor Large/Small; no paired original WAV + reference MIDI has been tested.
- Sound from user's speakers/Kontakt; long-song CPU performance, memory pressure and full 4-minute Transkun transcription in Windows (only 2s smoke checked).
- Transkun inferred CC64 on a genuine sustained piano recording; no CC64 event is fabricated when the model outputs none.
- Free/cloud browser hosting of Transkun V2.

## Next acceptance checks
1. Windows Portable on E:, Engine → Transkun V2 Piano → **Cài AI Piano**. Allow large download/installation and keep adequate free disk space; do not move user data to C:.
2. Open a short piano-only test (~20–30s), click **Nhận diện nốt** explicitly, then inspect MIDI, velocity and CC64.
3. Run same source with MuScriptor Small/Large for an honest A/B benchmark against aligned reference MIDI (pitch/onset/offset). Do not merge #30 until actual user testing/approval.

Notes: Transkun MIT; MuScriptor CC BY-NC 4.0 and must not be silently relicensed. Avoid TinyFish, CMD, paid services and main/production changes.
