#!/usr/bin/env bash
# Start the LinuxONE Community Cloud Jupyter Lab ML container on this VM (RHEL 9, Podman).
#
# Differences from the platform's own README, on purpose:
#   - Jupyter listens on the VM's loopback only; reach it through an SSH tunnel (see ml/LINUXONE.md).
#     The README opens port 38888 to the whole internet.
#   - The login token is random and stored in ~/.jupyter_token (mode 600). The README leaves the
#     published default token "Your_Token1", which anyone could use to run code on the VM.
#   - Lingering is enabled, otherwise rootless Podman stops the container when your SSH session ends.
# Safe to run again: it keeps the existing token and recreates the container.
set -euo pipefail

IMG=registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x:latest
REPO=${REPO:-$HOME/Nexus-Z}      # this repository
DATA=${DATA:-$HOME/data}         # datasets, trained models, caches
SHARED=${SHARED:-$HOME/shared}   # logs and files to exchange with the container

command -v podman >/dev/null || sudo dnf -y install podman
sudo loginctl enable-linger "$USER"
mkdir -p "$DATA" "$SHARED"
chmod a+w "$SHARED"
[ -s "$HOME/.jupyter_token" ] || ( umask 077; openssl rand -hex 24 > "$HOME/.jupyter_token" )
TOKEN=$(cat "$HOME/.jupyter_token")

podman image exists "$IMG" || podman pull "$IMG"
podman rm -f notebook >/dev/null 2>&1 || true
# keep-id maps your VM user onto the container's ibm-user (uid 1000) so mounted folders are writable
podman run -d --name notebook --network host --userns=keep-id:uid=1000,gid=1000 \
  -v "$REPO":/home/ibm-user/Nexus-Z:z -v "$DATA":/home/ibm-user/data:z -v "$SHARED":/home/ibm-user/shared:z \
  "$IMG" jupyter notebook --config /home/ibm-user/.jupyter/jupyter_server_config.py \
  --ServerApp.ip=127.0.0.1 --ServerApp.port=38888 --ServerApp.token="$TOKEN" --ServerApp.allow_origin='' > /dev/null

sleep 10
podman exec notebook pip install -q pytest 2>&1 | grep -v -i notice || true   # tests only; training needs nothing extra
echo "container: $(podman ps --format '{{.Names}} {{.Status}}')"
echo "listening: $(ss -ltn | grep 38888 || echo 'not yet')"
echo "token is in ~/.jupyter_token. From your own computer: ssh -L 38888:localhost:38888 <user>@<vm>, then open http://localhost:38888"
