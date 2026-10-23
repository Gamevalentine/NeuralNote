# NOTIQ 5M-D — Windows release acceptance gate (experimental)

Date: 23 October 2026. Base Stage 5M-C resumable native MuScriptor. Draft PR; stable main and production unchanged.

## What is implemented
A new local **AI 5M-D** panel in NOTIQ Windows requires evidence before any claim that 4 or 6 CPU threads improve Large on the target i5-1135G7 laptop. This is a *QA and release acceptance layer*, not a new inference engine.
- Stage 5M-B 20/30/60s benchmark runs must use the **same model, exact PCM SHA256, excerpt start and duration**. At least **two independent runs** for 2-thread baseline and each candidate CPU setting. Each distinct run is retained in the current session (bounded to 36); before 5M-D the UI accidentally discarded repeats of a given setting.
- Median **inference-only** runtime, peak native-process RAM and note-output SHA256 are displayed for 2/4/6 threads. A candidate requires >=10% faster inference, <=30% higher peak RAM, and byte-identical note-result hashes relative to stable 2-thread baseline, including repeat consistency. Missing RAM/time/hash is inconclusive, not interpreted as zero or a successful improvement. Different PCM clips cannot be compared even if filenames match. Hash equality is stricter than note count, but does *not* establish note accuracy.
- Quality comparison requires a user-provided **MIDI reference** (already supported by NOTIQ 5I), and the exported 5L MIDI from the **same recording** as a separate baseline imported through 5M-D. Uses the existing verified pitch/onset +/-100ms matching and reports absolute F1 and before/after percentage points. If F1 decreases by >1 percentage point, quality gate fails. Both recordings must be manually confirmed as corresponding/aligned; unconfirmed data is never promoted.
- Three further explicit **manual acceptance confirmations**: full-song completion, stop/resume checkpoint observed, notes at 5-second seams heard/compared. These are subjective user assertions, not automated QA.
- Result banner stays **NOT ACCEPTED** unless local performance candidate + matching reference MIDI non-regression + all manual checks. Even then it is only **review-ready**, NEVER automatic production merge.
- Export a local JSON report with aggregate metrics, F1, manual checklist and clear uncertainty, **without raw WAV, note list, model weights or personal local paths**. No telemetry, paid services or CMD required.

## CI
New Windows workflow tests pure 5M-D audit strictness (repeats, matching PCM, RAM insufficiency, hash mismatch, reference missing/F1 drop), pre-existing real C++ checkpoint CLI self-test, TypeScript/Vite renderer and old MIDI regressions; repacks the unchanged 5M-C native C++ in Windows Portable. Requires final Action SUCCESS and artifact presence before being presented as a verified build.

## Important limitations
Neither GitHub Actions nor the local audit panel has the user's Large 2.74GB GGUF or actual five-minute recording. **No end-to-end Large inference speedup, F1 non-regression, checkpoint/resume after a real interruption, or 4/6 CPU superiority is claimed without those tests.** A 20-second clip is not the complete song. The F1 matcher checks note pitch/onset (offset errors shown separately), not acoustic naturalness/CC64 resonance.
Retain default 2 threads and keep the draft PR unmerged until acceptance reports support another choice.
