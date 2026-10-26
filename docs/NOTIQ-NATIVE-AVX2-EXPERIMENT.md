# NOTIQ Native CPU Performance — AVX2 isolation & short diagnostic plan

## Baseline evidence (27 Oct 2026)
Read prior technical log `docs/NOTIQ-STAGE5PD-REAL-PIANO-QA.md` before modifying engine.
- 5P-D real acoustic 20-second excerpt, genuine MuScriptor Large F16 GGUF, 4 threads: **900.56 seconds, only 39%**, ~4.03 GiB peak native RSS, 3.734 average CPU cores, **no finished MIDI and no F1**.
- Original Stage5P-D Large auto-workflow was previously shut off. Never run a weight download or multi-minute inference on push.
- The upstream pinned MuScriptor revision is `c8adc019677ed3479fa3c22c1a117d662382f347` (also present in the local MIT-licensed vendor source). Pinned ggml is `e91ded11bdcd78c42f9c8d3978ff6686eb4c1226` (v0.23.0).
- **Source finding:** In original `cpp/CMakeLists.txt`, `GGML_AVX2`, `GGML_BMI2`, `GGML_FMA` are explicitly forced OFF for ancient CPU compatibility. In pinned ggml x86 CMake, when these are enabled MSVC selects `/arch:AVX2`, `GGML_AVX2`, `GGML_FMA` and `GGML_BMI2`. Turning on the ISA is **plausible** to help F16 CPU matmuls, but no real model speedup is measured at this step. We must not equate CPU instructions with 3x or 10x improvement without measurements.

## Implemented on isolated branch `feature/notiq-native-avx2-diagnostic`
1. `notiq-native/CMakeLists.txt`: default `NOTIQ_ENABLE_AVX2_DIAGNOSTIC=OFF`, still uses the **original** submodule and identical upstream baseline. Optional ON requires MSVC Windows x64 and uses the existing locally vendored copy of the **identical pinned upstream revision**.
2. `notiq-ai-core/vendor/muscriptor/cpp/CMakeLists.txt`: a single **NOTIQ-local derivative modification** allows `NOTIQ_EXPERIMENTAL_AVX2=ON` to enable ggml AVX2, BMI2, FMA. Default remains OFF. The historical `SOURCE_MANIFEST.json` is the **pristine upstream revision manifest**; this patched CMake file intentionally differs from its recorded pristine SHA (do not pretend the vendor tree remains byte-identical). All original CPP model files and model weights are unchanged, and third-party MIT and PFFFT BSD licenses remain.
3. `notiq-native/cpu_isa.hpp`: runtime CPU and OS check with MSVC CPUID, FMA, AVX2, BMI2, OSXSAVE and XCR0 XMM/YMM before letting optional optimized variant load model. Unsupported CPUs must use baseline. `--cpu-isa` reports the variant and host support. Never ship optimized EXE as an unguarded universal download.
4. `notiq-native/main.cpp`: new optional `--timing` diagnostic flag emits measured `NOTIQ_TIMING_LOAD_WALL_MS` and per-transcription-update `wall_ms` and `finalized_through_s`. Defaults unchanged. It does not infer F1 or create synthetic model progress.
5. `scripts/5pd/benchmark_real_piano.py`: captures these **real** timing messages for any future explicitly approved, time-bounded, same-file benchmark; missing measurements stay null.
6. `scripts/native_avx2`: two tiny standalone Windows x64 MSVC builds verify generic vs optimized build markers and CPU/OS support detection. Python tests verify pinned vendor submodule revision, feature flags' default-off release isolation, no automatic Large job, and runtime refusal before model entry. **No model, no audio and no native ggml inference download in this CI**.

## Safety and acceptance gates
- This changes NO production branch and DOES NOT recommend a user download. Draft PR targets Stage 5P-D feature branch rather than main.
- The tiny preflight tests prove safe source wiring, header compilation and ISA feature probing. They do **not** prove that the full optimized MuScriptor library compiles, that its real output is correct, nor that its full-song Large inference is faster.
- Before shipping any optimized build, a future strictly **manual** limited benchmark must compare baseline and optimized on identical REAL short audio, same verified GGUF and CPU, report wall time, CPU, RAM and MIDI differences, then check at least one full-length song and release constraints. If optimization gains little, stop and consider different engine or model rather than restarting one-hour blind workflows.
- The 5P-D original expensive workflow remains manual-only with explicit `enable_large_diagnostic=true`. Do not dispatch it without the owner's separate approval.
