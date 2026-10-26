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
