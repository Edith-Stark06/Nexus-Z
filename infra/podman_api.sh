#!/usr/bin/env bash
# Build and run the NEXUS Z API in a rootless Podman container on the LinuxONE VM.
#
#   bash infra/podman_api.sh build     # build the image (needs the Jupyter base image already pulled)
#   bash infra/podman_api.sh start     # run it; the API listens on 127.0.0.1:$NEXUSZ_PORT of the VM only
#   bash infra/podman_api.sh status    # container state and /health
#   bash infra/podman_api.sh logs
#   bash infra/podman_api.sh stop      # stop and remove the container (repo, data and model are untouched)
#
# Only the container named $NAME is ever touched; the Jupyter container ("notebook") is left alone.
# NOT YET TESTED ON THE VM. If a step fails there, use infra/run_api.sh or the systemd unit instead and do
# not describe the deployment as containerized.
set -euo pipefail

NAME="${NEXUSZ_CONTAINER:-nexusz-api}"
IMAGE="${NEXUSZ_IMAGE:-localhost/nexusz-api:latest}"
PORT="${NEXUSZ_PORT:-8000}"
REPO="${NEXUSZ_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${NEXUSZ_DATA_DIR:-$HOME/data}"
BUNDLE="${NEXUSZ_BUNDLE:-$HOME/bundle}"
BACKEND="${NEXUSZ_BACKEND:-model}"

case "${1:-}" in
  build)
    podman build -t "$IMAGE" -f "$REPO/infra/Containerfile" "$REPO/infra"
    ;;
  start)
    podman image exists "$IMAGE" || { echo "image $IMAGE not found; run: bash infra/podman_api.sh build" >&2; exit 1; }
    if [ "$BACKEND" = model ]; then
      [ -f "$DATA_DIR/ibm-aml/${NEXUSZ_SLICE:-HI-Slice}_Trans.csv" ] || { echo "slice not found under $DATA_DIR/ibm-aml" >&2; exit 1; }
      [ -f "$BUNDLE/model.json" ] || { echo "model bundle not found at $BUNDLE" >&2; exit 1; }
    fi
    podman rm -f "$NAME" >/dev/null 2>&1 || true   # only our own container
    # Mounts are read-only. keep-id maps your user to uid 1000 as in ml/LINUXONE.md.
    podman run -d --name "$NAME" --userns=keep-id:uid=1000,gid=1000 \
      -p "127.0.0.1:$PORT:8000" \
      -v "$REPO:/srv/nexusz/repo:ro" -v "$DATA_DIR:/srv/nexusz/data:ro" -v "$BUNDLE:/srv/nexusz/bundle:ro" \
      -e NEXUSZ_BACKEND="$BACKEND" -e NEXUSZ_SLICE="${NEXUSZ_SLICE:-HI-Slice}" \
      -e NEXUSZ_HISTORY_HOURS="${NEXUSZ_HISTORY_HOURS:-0}" -e NEXUSZ_ACTIVE_HOURS="${NEXUSZ_ACTIVE_HOURS:-24}" \
      -e NEXUSZ_MIN_REFRESH_SECONDS="${NEXUSZ_MIN_REFRESH_SECONDS:-5}" \
      -e NEXUSZ_CORS_ORIGINS="${NEXUSZ_CORS_ORIGINS:-}" \
      "$IMAGE"
    echo "started $NAME; wait for startup (model mode builds its state first), then: curl -fsS http://127.0.0.1:$PORT/health"
    ;;
  status)
    podman ps -a --filter "name=^${NAME}$" --format '{{.Names}}  {{.Status}}  {{.Ports}}'
    curl -fsS "http://127.0.0.1:$PORT/health" && echo || echo "health check failed"
    ;;
  logs)
    podman logs --tail 100 -f "$NAME"
    ;;
  stop)
    podman rm -f "$NAME"
    ;;
  *)
    sed -n '2,12p' "$0"; exit 2
    ;;
esac
