# NOTIQ — Bounded baseline vs AVX2 native A/B, 27 Oct 2026

## Source and prior evidence (must read before technical work)
- Read `docs/NOTIQ-NATIVE-AVX2-EXPERIMENT.md` on `feature/notiq-native-avx2-diagnostic`.
- Original Large F16 (2.74 GB) failed to finish a 20-second genuine piano clip after 900.56 seconds: model progress 39%, measured native peak ~4.03 GiB, CPU 3.734 core-equivalent, no exported MIDI/F1. **Do not repeat a 15–70-minute Large experiment blindly**.
- A previous Windows test #40380191813 passed 5/5 source policy checks, 13/13 timing/benchmark parsers and 2/2 header-only ISA smoke tests. It did **NOT** compile the complete AVX2 MuScriptor engine.
- User now approved proceeding with a bounded A/B comparison. All new work must stay in feature branch and `main` unchanged.

## Real experiment setup
1. Build two **FULL C++ Windows MuScriptor ggml native engines** from the identical pinned revision in *separate* MSVC Release directories. Baseline leaves original compatibility flags OFF, optimized explicitly opts into AVX2/BMI2/FMA. `--cpu-isa` and real checkpoint self-test must succeed on BOTH binaries before continuing.
2. Confirm AVX2/FMA/BMI2 CPU + OSXSAVE/XCR0 support on the runner. If unavailable, DO NOT execute experimental binary.
3. Use a single copyrighted-free source: [Meta Open Sound](https://github.com/facebookincubator/Meta-open-sound) piano A4 Vel01 OGG, CC0 1.0, pinned commit `251c0be57d5d1b3242b91f53e0cde62ab1cb42d9`, single isolated acoustic piano sample, not a full song and no aligned score.
4. Decode exactly the same 3-second PCM Float32/mono/16kHz WAV to both engines. Use original pinned **Small F16 209,425,152 bytes** SHA256 `925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4`, **NOT Large**, avoiding 2.74 GB transfer.
5. Each real native invocation is forcibly killed after **60 seconds** if incomplete. The report includes actual wall time, measured native PID working-set peak and CPU core equivalent, real PROGRESS and optional true load/chunk timings. It does not interpolate or invent missing notes.
6. If both complete, compare elapsed seconds and SHA256 of full genuine native note records (pitch, onset/off, amplitude, program) and flag differences. If either incomplete, **NO quantified speedup or musical correctness claim**. Even if Small succeeds, no Large full-song/F1/pedal claim follows.
7. Entire GitHub Actions job bounded at 20 minutes including C++ MSVC builds and downloads; heavier real A/B is NOT triggered on normal commits: only specifically reviewed `[AB_RUN_ONCE]` commit or explicit user-approved manual dispatch. Privacy: upload ONLY aggregate JSON, never model, WAV or MIDI bytes.

## Release criteria
- This is **engine feasibility profiling**, not production or a user's Windows benchmark.
- A synthetic sine wave is not used; the test audio is one CC0 real recorded piano key. It is **not** same-performance piano corpus ground truth, and provides no F1 score.
- Source-based full native build success and actual 60-second capped measurements must be evidenced by the exact GitHub run, not predicted from code. After any failed step, investigate logs and report honest blocker.
- Avoid repeated costly test runs; if the first full A/B run fails due CMake or manifest bug, fix that without relaunching Large weights.


## Actual completed Windows A/B — 27 October 2026

- GitHub Actions [run #40386200301](https://github.com/Gamevalentine/NeuralNote/actions/runs/40386200301), source SHA `9abeda120ab3fe118a2fa89ad3ba63616a705409`: **completed/success** on `windows-latest`. First job `safe-preflight` PASS. Both *complete* MSVC CMake Release MuScriptor native CLI builds PASS, source baseline mode verified OFF, experimental AVX2 mode verified ON, both CLI checkpoint self-tests PASS. Runner CPUID/XCR0 confirmed AVX2/FMA/BMI2 available.
- The 3-second raw piano A4 sample is CC0 from pinned Meta Open Sound commit `251c0be57d5d1b3242b91f53e0cde62ab1cb42d9`. Its re-encoded PCM/mono/16kHz SHA256: `72f6d5cb4980914252301a693fd9ee93b4f974e89abe0dcd87d279217aa2b41a`. **This is a recorded isolated key, not full musical performance or reference-MIDI ground truth.**
- Both processes used **the same verified MuScriptor Small F16** model (209,425,152 bytes, SHA256 `925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4`), 4 CPU threads. Each could run at most 60 seconds, neither timed out, exit code 0, both reported true `PROGRESS 100` and produced native JSON with valid schema.
- **Baseline**: **28.890 s** end-to-end native wall time, **28,466 ms** longest native chunk, **270 ms** model load, **474,910,720 bytes** peak native RSS, 3.812 average CPU cores. Output: **0 notes**.
- **AVX2/BMI2/FMA**: **2.125 s** end-to-end native wall time, **1,782 ms** longest native chunk, **272 ms** model load, **474,939,392 bytes** peak native RSS, 3.000 average CPU cores. Output: **0 notes**.
- **Measured A/B speed ratio: 13.595×** based strictly on **28.890/2.125** for **this Single 3-second sample using Small**. Both native chunk timings confirm meaningful compute acceleration. No extrapolation to Large, longer songs, other computers, real-world average or physical music.
- Both native note-content SHA256 are the SHA of an empty list `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`. **No detected pitches, no meaningful equivalence of MIDI notes, no F1, no evidence of music quality or CC64/velocity.**
- Exact diagnostic artifact ID **12681487333**, 1,093 bytes ZIP with a single JSON; independently downloaded and ZIP CRC-checked (PASS). GitHub ZIP SHA256 `2c4e080b956c9dee22ac873f75123910d24b457fe6c8de2e7e5e0025f8f0f17f`, locally recomputed hash matched. Expires **2026-11-02T19:29:17Z**. All raw audio, GGUF and generated MIDI stayed on runner; only JSON diagnostics were uploaded.

### Critical report interpretation correction (no heavy rerun)
The initial JSON `comparison.output_midi_verified:true` meant merely that two outputs had valid native JSON schema, but it was **incorrect as a statement of actual note accuracy** because both emitted 0 notes. Fixed `scripts/native_avx2/ab_smoke.py`: `COMPLETE_NATIVE_SMOKE_ZERO_NOTES`, `output_midi_verified:false`, `equal_note_sha256:null` for empty outputs; even for non-empty matching results, `output_midi_verified:false` until ground-truth reference MIDI exists. Added two regression cases. The original uploaded ZIP is retained as immutable evidence; **this corrected interpretation supersedes that field**. The measurement timings and hashes are unaffected. This fix does **not** justify rerunning the Small model.

## Safe decision
- AVX2 looks very promising for reducing CPU math time in MuScriptor, based on a single measured Small-model sample, not a proof of Large/full-song throughput.
- Need a correctly detected **non-empty** note set and aligned reference comparison in a bounded opt-in benchmark, then validated Large startup and a full song **only after** actual practicality is established. The present A/B experiment is sufficient to prioritize AVX2, but **NOT** to authorize release.
- Do not switch default build, merge to `main`, download a 2.74GB model or run extended workflow without further evidence and permission.
