#!/usr/bin/env bash
# Start the NEXUS Z API in the foreground (no container). Used directly, or by the systemd unit.
#
#   bash infra/run_api.sh                       # stub backend, 127.0.0.1:8000
#   NEXUSZ_BACKEND=model NEXUSZ_DATA_DIR=~/data bash infra/run_api.sh
#
# Settings are plain environment variables; see api/backend.py for the full list. An optional file
# ~/.config/nexusz/api.env (KEY=value lines, see infra/api.env.example) is read first and never
# overrides variables you already set in the shell.
set -euo pipefail

REPO="${NEXUSZ_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
VENV="${NEXUSZ_VENV:-$HOME/nexusz-venv}"
ENV_FILE="${NEXUSZ_ENV_FILE:-$HOME/.config/nexusz/api.env}"

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in ''|\#*) continue ;; esac
    [ -n "${!key+x}" ] || export "$key=$value"   # only fill in what is not already set
  done <"$ENV_FILE"
fi

HOST="${NEXUSZ_HOST:-127.0.0.1}"   # loopback by default; reach it from your own computer with an SSH tunnel
PORT="${NEXUSZ_PORT:-8000}"
if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ]; then
  echo "WARNING: binding to $HOST exposes the API (it has no authentication). Prefer 127.0.0.1 and an SSH tunnel." >&2
fi
[ -x "$VENV/bin/python" ] || { echo "virtualenv $VENV not found; run infra/setup_vm.sh" >&2; exit 1; }

cd "$REPO"
echo "NEXUS Z API: backend=${NEXUSZ_BACKEND:-stub} on http://$HOST:$PORT (repo $REPO)" >&2
exec "$VENV/bin/python" -m uvicorn api.main:app --host "$HOST" --port "$PORT" --log-level "${NEXUSZ_LOG_LEVEL:-info}"
