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
# The dashboard runs on the VM too, in its own container (same hardening), so the laptop only needs the tunnel and a browser:
#   bash infra/podman_api.sh dash-start   # serves $NEXUSZ_DASHBOARD_DIST (default ~/nexusz-dashboard-dist) on 127.0.0.1:3000 of the VM
#   bash infra/podman_api.sh dash-stop
# The dashboard is built where Node is installed (cd dashboard && npm ci && npm run build) and its dist folder is copied to the VM.
# From the laptop: ssh -N -L 8000:127.0.0.1:8000 -L 3000:127.0.0.1:3000 <user>@<vm>, then open http://localhost:3000.
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
DASH_NAME="${NEXUSZ_DASHBOARD_CONTAINER:-nexusz-dashboard}"
DASH_DIST="${NEXUSZ_DASHBOARD_DIST:-$HOME/nexusz-dashboard-dist}"
DASH_PORT="${NEXUSZ_DASHBOARD_PORT:-3000}"
CHAT_SECRET="${NEXUSZ_CHAT_SECRET:-nexusz_hf_token}"
WATSONX_SECRET="${NEXUSZ_WATSONX_SECRET:-nexusz_watsonx_key}"   # IBM Cloud API key for watsonx.ai (infra/set_watsonx_key.sh)
INTENT_DIR="${NEXUSZ_INTENT_DIR:-$DATA_DIR/granite-embedding-30m-english}"   # IBM Granite Embedding 30M, from infra/prepare_granite_embedding.sh
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
    # The assistant's Hugging Face token is a podman secret (infra/set_chat_token.sh), mounted as a read-only file for the container user only.
    # Without it the assistant answers from its built-in rules. The token is never an environment variable, so `podman inspect` cannot show it.
    SECRET_ARGS=""
    if podman secret exists "$CHAT_SECRET" 2>/dev/null; then SECRET_ARGS="--secret $CHAT_SECRET,type=mount,uid=1000,gid=1000,mode=0400"; fi
    # watsonx.ai: the API key is a second podman secret; the region URL and the project id are not secret and come from the environment.
    if podman secret exists "$WATSONX_SECRET" 2>/dev/null; then SECRET_ARGS="$SECRET_ARGS --secret $WATSONX_SECRET,type=mount,uid=1000,gid=1000,mode=0400"; fi
    # IBM Granite Embedding runs inside the API container and picks the topic of a question. Read-only, offline, no token needed.
    INTENT_ARGS=""
    if [ -f "$INTENT_DIR/config.json" ] && [ "${NEXUSZ_CHAT_INTENT:-on}" != off ]; then
      INTENT_ARGS="-v $INTENT_DIR:/srv/nexusz/granite-embedding-30m-english:ro,z -e NEXUSZ_CHAT_INTENT_MODEL=/srv/nexusz/granite-embedding-30m-english -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e HF_HOME=/tmp/hf -e OMP_NUM_THREADS=2"
    fi
    podman run -d --name "$NAME" $USERNS $SECRET_ARGS $INTENT_ARGS \
      -p "127.0.0.1:$PORT:8000" \
      --read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges --memory "${NEXUSZ_MEMORY:-5g}" --pids-limit 512 \
      -v "$REPO:/srv/nexusz/repo:ro,z" -v "$DATA_DIR:/srv/nexusz/data:ro,z" -v "$BUNDLE:/srv/nexusz/bundle:ro,z" \
      -v "$PYLIBS:/srv/nexusz/pylibs:ro,z" \
      -e PYTHONPATH=/srv/nexusz/repo:/srv/nexusz/pylibs -e PYTHONDONTWRITEBYTECODE=1 \
      -e NEXUSZ_BACKEND="$BACKEND" -e NEXUSZ_DATA_DIR=/srv/nexusz/data -e NEXUSZ_BUNDLE=/srv/nexusz/bundle -e NEXUSZ_SLICE="$SLICE" \
      -e NEXUSZ_HISTORY_HOURS="${NEXUSZ_HISTORY_HOURS:-24}" -e NEXUSZ_ACTIVE_HOURS="${NEXUSZ_ACTIVE_HOURS:-24}" \
      -e NEXUSZ_MIN_REFRESH_SECONDS="${NEXUSZ_MIN_REFRESH_SECONDS:-5}" -e NEXUSZ_CORS_ORIGINS="${NEXUSZ_CORS_ORIGINS:-}" \
      -e NEXUSZ_CHAT="${NEXUSZ_CHAT:-auto}" -e NEXUSZ_CHAT_MODELS="${NEXUSZ_CHAT_MODELS:-}" \
      -e NEXUSZ_CHAT_BASE_URL="${NEXUSZ_CHAT_BASE_URL:-https://router.huggingface.co/v1}" -e NEXUSZ_CHAT_REASONING_EFFORT="${NEXUSZ_CHAT_REASONING_EFFORT-low}" \
      -e NEXUSZ_WATSONX_URL="${NEXUSZ_WATSONX_URL:-}" -e NEXUSZ_WATSONX_PROJECT_ID="${NEXUSZ_WATSONX_PROJECT_ID:-}" -e NEXUSZ_WATSONX_MODELS="${NEXUSZ_WATSONX_MODELS:-}" \
      -w /srv/nexusz/repo "$IMAGE" \
      "$PY" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 75 >/dev/null     # 0.0.0.0 is inside the container only
    echo "started $NAME; wait about 30 s (model mode builds its first state), then: curl -fsS http://127.0.0.1:$PORT/health"
    ;;
  dash-start)
    [ -f "$DASH_DIST/index.html" ] || { echo "no built dashboard in $DASH_DIST; build it and copy dist there (see the header of this script)" >&2; exit 1; }
    podman rm -f "$DASH_NAME" >/dev/null 2>&1 || true
    podman run -d --name "$DASH_NAME" $USERNS -p "127.0.0.1:$DASH_PORT:3000"       --read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges --memory 256m --pids-limit 64       -v "$DASH_DIST:/srv/dash:ro,z" -v "$REPO/infra/serve_dashboard.py:/srv/serve_dashboard.py:ro,z"       -e PYTHONDONTWRITEBYTECODE=1 -w /srv "$IMAGE"       "$PY" /srv/serve_dashboard.py /srv/dash --host 0.0.0.0 --port 3000 >/dev/null
    echo "started $DASH_NAME on 127.0.0.1:$DASH_PORT of this machine; reach it with an SSH tunnel (see the header)"
    ;;
  dash-stop)
    podman rm -f "$DASH_NAME"
    ;;
  check)
    echo "== sockets listening on the API and dashboard ports (must be loopback only)"; ss -ltn | grep -E ":($PORT|$DASH_PORT) " || echo "none"
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
    echo "== assistant (never prints the token)"
    if podman secret exists "$CHAT_SECRET" 2>/dev/null; then echo "token secret: stored, mounted read-only for the container user"; else echo "token secret: none (no hosted model; Granite Embedding or the rules answer)"; fi
    if podman secret exists "$WATSONX_SECRET" 2>/dev/null; then echo "watsonx key secret: stored"; else echo "watsonx key secret: none"; fi
    podman exec "$NAME" sh -c 'ls -l /run/secrets/ 2>/dev/null || echo "no secrets mounted in the container"'
    if [ -f "$INTENT_DIR/config.json" ]; then echo "Granite Embedding: $INTENT_DIR (mounted read-only, offline)"; else echo "Granite Embedding: not downloaded (run infra/prepare_granite_embedding.sh)"; fi
    curl -fsS "http://127.0.0.1:$PORT/chat/status" || echo "chat status unavailable"
    echo
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
