# NOTIQ Web → original MuScriptor engine (private preview only)

**Status:** API + Web adapter source ready for QA. No server has been deployed by this change. The production Web/Windows apps remain unchanged.

- Browser uploads the entire song after converting to WAV 16 kHz, mono, float32 (up to **15 minutes**, WAV payload ~57.6 MB). Backend never samples only the first 45 seconds.
- The exact existing `notiq-native/main.cpp` C++ CLI executes the actual `ThirdParty/muscriptor.cpp` transcriber with MuScriptor GGUF weights, returns the established JSON protocol. No Basic Pitch substitution or fake notes.
- Single concurrent job; 24+ character private access key; exact CORS origin; upload cap; model/CLI presence check; max runtime; polling real CLI progress; temporary WAV and JSON deleted on completion/error. Job metadata is discarded after 10 minutes.
- The user enters the **private access key once per browser session** in a browser prompt on first transcription; no key in GitHub, build output, or URL. The key must be provisioned by an administrator through the deployment provider UI. CORS alone is not authentication.
- On frontend preview configure only `VITE_NOTIQ_MUSCRIPTOR_API=https://<your-api-host>` in the frontend deployment's environment panel. No API URL = unchanged UI-only behavior, no audio upload.
- Server environment variables: `NOTIQ_API_KEY` (24+ random chars), `NOTIQ_ALLOWED_ORIGIN` (the exact HTTPS preview origin), `NOTIQ_CLI_PATH`, `NOTIQ_MODEL_PATH`, `PORT`. Never put the key in `VITE_*`.
- Backend health: `GET /api/health`. Worker: `POST /api/jobs` (raw Content-Type audio/wav + x-notiq-key), `GET /api/jobs/:id` to poll, `DELETE /api/jobs/:id` to cancel.
- Runtime model downloader in `bootstrap.mjs` only when `NOTIQ_MODEL_DOWNLOAD=1` is explicitly set. Its pinned GGUF checksum is verified, not checked into the repository. Model weights license: **CC BY-NC 4.0, noncommercial only**. Confirm deployment meets terms.
- API and Web are **not yet end-to-end tested against a real model on a cloud host**. `server.test.mjs` only checks HTTP/security/progress/routing with a clearly injected mock child process. A successful mock test is not an audio recognition QA pass.

## Building / preview

The optional Dockerfile builds original C++ MuScriptor on Linux, starts Node 22 with no third-party web server dependencies, and downloads model on startup if configured. Check that your service provider explicitly supports free CPU and RAM before deployment; do not start a paid resource without consent. Use a private staging service with adequate resources for a ~209 MB GGUF model and its working memory.

Do **not** switch Cloudflare Pages production branch or merge into `main` before actual end-to-end inference and user review. There is no need for the user to run Windows CMD.
