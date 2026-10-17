#!/usr/bin/env bash
# Run the NEXUS Z API in a hardened rootless Podman container on the LinuxONE VM.
#
#   bash infra/podman_api.sh deps      # once: put the web packages (fastapi, uvicorn, pydantic) in a host folder
#   bash infra/podman_api.sh start     # run it; the API listens on 127.0.0.1:$NEXUSZ_PORT of the VM only
#   bash infra/podman_api.sh check     # print the security settings of the running container (for screenshots)
#   bash infra/podman_api.sh status    # container state and /health
#   bash infra/podman_api.sh logs
#   bash infra/podman_api.sh stop      # stop and remove the container (repo, data and model are untouched)
#
# It runs the platform's own image (the one the Jupyter container uses), which already has numpy, pandas, XGBoost and scipy
# built for s390x. There is no image build: `podman build` on top of that image fails on this VM with "unsupported MIME type for
# compression" (a podman storage problem with the pulled image, before any of our steps run), so infra/Containerfile is kept
# only as a record of what a build would add. The three web packages the image lacks go in $PYLIBS and are mounted read-only.
#
# Hardening (all checked by `check`): non-root user, read-only root filesystem with a small tmpfs, every Linux capability dropped,
# no-new-privileges, memory and process limits, read-only mounts of the repo, data and model, and the port published on the VM's
# loopback only. Not possible here: --cpus (the user's cgroup has no cpu controller). SELinux is enforcing, hence the :z labels.
#
# Only the container named $NAME is ever touched; the Jupyter container ("notebook") is left alone.
set -euo pipefail

NAME="${NEXUSZ_CONTAINER:-nexusz-api}"
IMAGE="${NEXUSZ_IMAGE:-registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x:latest}"
PORT="${NEXUSZ_PORT:-8000}"
REPO="${NEXUSZ_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${NEXUSZ_DATA_DIR:-$HOME/data}"
BUNDLE="${NEXUSZ_BUNDLE:-$REPO/ml/artifacts/HI-Small-pig}"
PYLIBS="${NEXUSZ_PYLIBS:-$HOME/nexusz-pylibs}"
BACKEND="${NEXUSZ_BACKEND:-model}"
SLICE="${NEXUSZ_SLICE:-HI-Pig-Slice}"
PY=/opt/venv/bin/python      # the platform image's interpreter (the default `python` is the system one, without the packages)
USERNS="--userns=keep-id:uid=1000,gid=1000"   # the image's own user, as in ml/LINUXONE.md

case "${1:-}" in
  deps)
    mkdir -p "$PYLIBS"
    podman run --rm $USERNS -v "$PYLIBS:/pylibs:rw,z" "$IMAGE" \
      "$PY" -m pip install --no-cache-dir --target /pylibs "fastapi>=0.141" "uvicorn>=0.52" "pydantic>=2.13"
    ;;
  start)
    [ -d "$PYLIBS/fastapi" ] || { echo "web packages not found in $PYLIBS; run: bash infra/podman_api.sh deps" >&2; exit 1; }
    if [ "$BACKEND" = model ]; then
      [ -f "$DATA_DIR/ibm-aml/${SLICE}_Trans.csv" ] || { echo "slice not found: $DATA_DIR/ibm-aml/${SLICE}_Trans.csv" >&2; exit 1; }
      [ -f "$BUNDLE/model.json" ] || { echo "model bundle not found at $BUNDLE" >&2; exit 1; }
    fi
    podman rm -f "$NAME" >/dev/null 2>&1 || true   # only our own container
    podman run -d --name "$NAME" $USERNS \
      -p "127.0.0.1:$PORT:8000" \
      --read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges --memory "${NEXUSZ_MEMORY:-5g}" --pids-limit 512 \
      -v "$REPO:/srv/nexusz/repo:ro,z" -v "$DATA_DIR:/srv/nexusz/data:ro,z" -v "$BUNDLE:/srv/nexusz/bundle:ro,z" \
      -v "$PYLIBS:/srv/nexusz/pylibs:ro,z" \
      -e PYTHONPATH=/srv/nexusz/repo:/srv/nexusz/pylibs -e PYTHONDONTWRITEBYTECODE=1 \
      -e NEXUSZ_BACKEND="$BACKEND" -e NEXUSZ_DATA_DIR=/srv/nexusz/data -e NEXUSZ_BUNDLE=/srv/nexusz/bundle -e NEXUSZ_SLICE="$SLICE" \
      -e NEXUSZ_HISTORY_HOURS="${NEXUSZ_HISTORY_HOURS:-24}" -e NEXUSZ_ACTIVE_HOURS="${NEXUSZ_ACTIVE_HOURS:-24}" \
      -e NEXUSZ_MIN_REFRESH_SECONDS="${NEXUSZ_MIN_REFRESH_SECONDS:-5}" -e NEXUSZ_CORS_ORIGINS="${NEXUSZ_CORS_ORIGINS:-}" \
      -w /srv/nexusz/repo "$IMAGE" \
      "$PY" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 >/dev/null     # 0.0.0.0 is inside the container only
    echo "started $NAME; wait about 30 s (model mode builds its first state), then: curl -fsS http://127.0.0.1:$PORT/health"
    ;;
  check)
    echo "== sockets listening on the API port (must be loopback only)"; ss -ltn | grep ":$PORT " || echo "none"
    echo "== container settings"
    podman inspect "$NAME" --format 'user={{.Config.User}} readonly_rootfs={{.HostConfig.ReadonlyRootfs}} privileged={{.HostConfig.Privileged}} security_opt={{.HostConfig.SecurityOpt}} memory={{.HostConfig.Memory}} pids_limit={{.HostConfig.PidsLimit}}'
    podman inspect "$NAME" --format 'dropped capabilities: {{.HostConfig.CapDrop}}'
    echo "== mounts (rw=false means read-only)"; podman inspect "$NAME" --format '{{range .Mounts}}{{.Destination}} rw={{.RW}}{{"\n"}}{{end}}'
    echo "== process and privileges inside"; podman top "$NAME" user,pid,args | cut -c1-110
    podman exec "$NAME" grep -E 'CapEff|NoNewPrivs|Seccomp:' /proc/1/status
    echo "== writes from inside (only /tmp may succeed)"
    for p in /srv/nexusz/repo/x /srv/nexusz/data/x /usr/x /tmp/x; do
      if podman exec "$NAME" sh -c "touch $p" 2>/dev/null; then echo "$p: written"; else echo "$p: refused"; fi
    done
    echo "== resources"; podman stats --no-stream --format '{{.Name}} memory={{.MemUsage}} cpu={{.CPUPerc}}' "$NAME"
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
    sed -n '2,10p' "$0"; exit 2
    ;;
esac
