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

## Continuation log — 23 October 2026 (post-PR #39)
- Preserved legacy 5M-C Windows packaging workflow byte-for-byte on the 5M-D branch. Only `.github/workflows/notiq-stage5md-windows.yml` may produce the 5M-D release artifact; this avoids competing artifacts and accidental 5M-C relabeling.
- Strengthened benchmark acceptance: **every** one of the two or more independent runs per configuration must provide a finite positive native-process RAM peak, for both 2-thread baseline and 4/6 candidate. One sampled run plus another with missing RAM is **insufficient**, never accepted. The baseline 2-thread row is not interpreted as a failed candidate.
- MIDI F1 checks now reject invalid/non-finite scores and flag more than a **1 absolute percentage point** drop against 5L; smaller decreases are displayed as decreases, not improvements. Added targeted regression cases.
- Validation status: GitHub API reports **zero workflow runs on the 5M-D branch** at time of update. Therefore the changes above are **source changes only**, not a Windows CI PASS and not a verified Windows ZIP. Do not offer a renamed 5M-C artifact as 5M-D.
- Packaging remains pinned to the verified 5M-C artifact from run 39838381380, which is subject to GitHub retention. If that artifact expires, update the packaging source from a newly verified 5M-C build instead of silently substituting an older binary.
- Next gate: trigger the dedicated 5M-D Windows Action; verify Node/TypeScript/MIDI tests, native CLI checkpoint self-test, ZIP integrity and artifact identifier. Only then hand off the package for on-device Large benchmarking and five-minute audio acceptance.


## Stage 5M-D1 GitHub Actions diagnosis — 23 October 2026
- Read back draft PR #39 and current Windows 5M-D/5M-C workflow sources before work. PR #39 remains open, draft, unmerged, targeting `feature/notiq-stage5mc-resume` (not `main`). Its branch is `feature/notiq-stage5md-acceptance`.
- The dedicated 5M-D YAML has `push` on the exact head branch and `pull_request` for the exact base branch; no skipped-CI commit annotation or merge conflict was observed in reviewed PR/commit metadata.
- Observed several source commits on the 5M-D branch, then attempted reopening the draft PR and, separately, a controlled `pull_request.edited` diagnostic. The latter was **reverted** after it yielded no runs. The normal workflow trigger is preserved.
- The GitHub Actions runs API still returns **0 runs** for the 5M-D branch after these events. No jobs have executed; zero runs is **not a test failure or PASS** and cannot be treated as a valid package.
- Connected GitHub actions support repository file commits, PR updates, status reads and rerunning **existing** jobs, but expose no workflow-dispatch action for a workflow that has never run. Actions workflow state/organization policy endpoints were not accessible through the connected read surface, so whether trigger suppression, workflow-registration restrictions or repository settings are responsible remains **unconfirmed**.
- Verified 5M-C Windows artifact ID **12452640664**, from run **39838381380**, is still available (expired=false, expires 2026-10-29 19:16:02 UTC). This validates the 5M-D packaging *input*, **not** the output ZIP.
- Blocker remaining: execute a new authorized GitHub workflow-dispatch or another genuinely delivered push/PR trigger, then inspect actual run ID, job logs and ZIP integrity. Do not edit `main`, mark D1 PASS or relabel 5M-C as 5M-D to bypass the gate.


## 5M-D1 independent pull_request.opened diagnostic (23 October 2026)
- Created temporary branch `ci/notiq-5md-trigger-diagnostic` at the **exact** 5M-D head commit `5431e848782774b59a3bce25cfe41f0be91fd485` with no changes to the workflow or application.
- Opened draft PR **#40** against the configured `feature/notiq-stage5mc-resume` base to generate a fresh `pull_request.opened` event. GitHub's Actions API reported **0 runs** on this diagnostic branch. The sole observed check on that SHA was **Cloudflare Pages**, not the requested Windows Actions workflow. PR #40 was immediately **closed, unmerged** after the negative result.
- Original PR #39 remains open/draft/unmerged, and `main` remains untouched. The disposable diagnostic branch still exists because this connection has no exposed branch-delete action; it has no releases or code changes.
- Official GitHub documentation: actions triggered by repository `GITHUB_TOKEN` events are suppressed except specific dispatch and PR events; this is a *candidate mechanism*, **not verified** as the token used by this GitHub connector. Manually invoked `workflow_dispatch` requires the workflow definition on the default branch; this definition is currently isolated from `main`, on purpose.
- **Conclusive scope of D1 findings:** The current authenticated tool set does not expose a `workflow_dispatch`/Actions write operation, and every available connected push/PR event attempted returned no Windows run. It is not legitimate to claim CI PASS, create a Windows ZIP artifact ID or keep cycling meaningless commits. A supported Actions-dispatch/browser session with authorized access is needed to execute the next gate; never put an untested workflow onto `main` as a workaround without approval.
