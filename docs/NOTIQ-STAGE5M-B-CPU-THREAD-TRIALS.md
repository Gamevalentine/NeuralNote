# NOTIQ 5M-B — CPU thread trials on identical 20/30/60-second audio

**Date:** 23 October 2026. Base: Stage 5M-A Windows. Draft PR. Main/production untouched.

## Problem to isolate
The user's i5-1135G7 / 16 GiB laptop needed >21 min on a ~5 min music track with MuScriptor Large 2.74 GB and native progress 20–21%. 20% is the *model-loaded* marker from original CLI; time spent decoding is the bottleneck. Before 5M-B, native C++ used `TranscribeOptions.n_threads=2` unconditionally. Merely changing a dropdown in Electron would not change inference.

## Actual changes
- **Recompiled C++ native CLI** from pinned `ThirdParty/muscriptor.cpp` library to accept an optional *fourth CLI arg* exactly `--threads=2`, `--threads=4`, or `--threads=6`. Invalid values rejected **before WAV/model loading**. Omitting the fourth arg still defaults to **2**, preserving legacy results. Includes a read-only `--capabilities` handshake returning the supported list and default.
- Electron starts only the verified native CLI; explicitly detects `--capabilities` rather than pretending the previous 5M-A binary can run 4 or 6 threads. Persists selected thread count with existing model preferences in portable `NOTIQ-Data/model-preferences.json`. Normal MuScriptor full-song inference passes the selected count, but the default remains 2 until the **user explicitly applies** a tested count.
- 5M-A benchmark now passes an actual whitelisted 2/4/6 value to the new native executable, and the result saves `threadCount`, checksum of exact PCM clip, checksum of output notes, model/clip identity, inference and model-load timings, process CPU and peak working set. The two hash values do not reconstruct raw WAV/notes; raw benchmark WAV/output are deleted. Results remain local in portable `NOTIQ-Data/benchmarks`, with no cloud upload.
- Windows UI: run **one selected 20/30/60-second test at a time**; choose 2, 4 or 6, same model/start/duration. Compare only when SHA-256 PCM clip matches across tests. Speedup uses **inference** milliseconds, not time to load GBs of weights. Display RAM differences and whether the output note list is byte-identical. An illustrative recommendation requires ≥10% faster inference, no more than 30% extra peak RAM and exact note-data fingerprint equality; this is not proof of pitch accuracy. No automatic switching. Apply count for future full-song jobs only by clicking a specific successfully tested count, with confirmation in status. No change to already edited MIDI.
- No change to MuScriptor weights/model quality, Transkun V2, pedal CC64, Piano Roll, Cloudflare stable Web, or GPU backend.
- Because some samples may produce different note sequences when thread count changes, **do not claim equal transcription accuracy based solely on equal note counts**. Hash equality is stricter than note-count equality, but reference MIDI is still needed to assess accuracy. A single speedup benchmark does not guarantee improvement across all songs.
- The best setting is hardware/thermal/signal dependent. CPU logical threads differ from physical cores; 6 threads may be worse or push RAM usage/thermals up. Manual 2-thread fallback is always available after it has been measured, and existing default is 2.

## Test/packaging gates
1. Rebuild actual native CLI using MSVC CPU-only on GitHub Actions with recursive pinned MuScriptor submodule; test `--capabilities`, legacy self-test and unsafe `--threads=999` rejection. No freeform CLI arguments accepted.
2. Unit tests cover whitelist, exact WAV source fingerprint, comparison only on same original clip/model/offset, mock child-process launch with **real** `--threads=2|4|6` command args, resource/report values, unsafe values blocked before spawn.
3. Windows electron TypeScript/Vite builds and Stage5A MIDI/pedal regressions. Copy the *newly compiled* native CLI into the original 5M-A Portable, verify the packaged `--capabilities` handshake, then repack UI/IPC into Electron ASAR. The GGUF and Python model are **not bundled**, no paid service.
4. Real-world acceptance requires user's *same 20-second piano clip*, start offset and Large model running separately with 2, 4 and 6 threads on their HP i5 laptop. Check runtime and RAM; repeat if results noisy due to thermal/cache changes. Only after this consider optimizing production. **CI cannot assert a real Large speedup without running that large checkpoint on the user's hardware**.

## Running without CMD
1. Extract full ZIP onto E: and place preexisting `models` and `NOTIQ-Data` next to portable EXE. Close older NOTIQ instances before launch.
2. Open an audio file, set MuScriptor Large (must already be installed), open **AI 5M-B**, select 20s offset 0 and **2 threads**; wait for metrics.
3. Repeat exactly the same model/audio/20s/offset with **4 threads**, and optionally **6**; each run is separate, not three automatically queued long CPU jobs.
4. Compare table. If a tested option is faster without excessive RAM and has acceptable MIDI changes, **click** `Áp dụng N luồng cho nhận diện`. The next MuScriptor full-song run uses that value. Close/switching does not rewrite earlier MIDI.
5. Send the table or the local JSON metrics to review. No Command Prompt or extra setup required. Use the Stop button if CPU becomes overloaded.

## Rollback
Discard draft branch or use Stage 5M-A to revert to the original fixed 2-thread C++ CLI. Selected thread preference is ignored by older Electron builds that only know Small/Large model choice.
