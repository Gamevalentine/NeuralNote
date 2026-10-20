#!/usr/bin/env bash
# Start only in a user-initiated GitHub Codespace. Private forwarded port only.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
if [ -z "${CODESPACE_NAME:-}" ]; then
  echo "This automatic preview requires a real GitHub Codespace."
  exit 1
fi
CLI="$ROOT/.notiq-build/notiq-muscriptor-cli"
if [ ! -x "$CLI" ]; then
  echo "MuScriptor C++ build is not ready; check Codespaces setup logs."
  exit 1
fi
mkdir -p "$ROOT/.notiq-preview/models"
umask 077
KEY_FILE="$ROOT/.notiq-preview/key"
if [ ! -s "$KEY_FILE" ]; then
  node -e "require('node:fs').writeFileSync(process.argv[1],require('node:crypto').randomBytes(32).toString('hex'))" "$KEY_FILE"
fi
export NOTIQ_API_KEY
NOTIQ_API_KEY="$(cat "$KEY_FILE")"
export NOTIQ_ALLOWED_ORIGIN="https://${CODESPACE_NAME}-5173.app.github.dev"
export NOTIQ_CLI_PATH="$CLI"
export NOTIQ_MODEL_PATH="$ROOT/.notiq-preview/models/muscriptor-small-f16.gguf"
export NOTIQ_MODEL_DOWNLOAD=1
export NOTIQ_CODESPACE_PREVIEW=1
export VITE_NOTIQ_MUSCRIPTOR_API=self
export PORT=8080
# Restart only previously created preview processes; don't affect unrelated apps.
for name in api web; do
  pidfile="$ROOT/.notiq-preview/$name.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" || true; fi
    rm -f "$pidfile"
  fi
done
nohup node "$ROOT/notiq-api/bootstrap.mjs" > "$ROOT/.notiq-preview/api.log" 2>&1 &
echo "$!" > "$ROOT/.notiq-preview/api.pid"
nohup npm --prefix "$ROOT/web" run dev -- --host 0.0.0.0 --port 5173 > "$ROOT/.notiq-preview/web.log" 2>&1 &
echo "$!" > "$ROOT/.notiq-preview/web.pid"
echo "NOTIQ Web will be on https://${CODESPACE_NAME}-5173.app.github.dev"
echo "The MuScriptor model is downloaded and verified privately before AI starts."
