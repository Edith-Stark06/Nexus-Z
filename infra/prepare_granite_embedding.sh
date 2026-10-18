#!/usr/bin/env bash
# Download IBM Granite Embedding 30M (English, Apache 2.0) to the LinuxONE VM so the assistant can understand questions without any hosted service.
#
#   bash infra/prepare_granite_embedding.sh            # about 120 MB, once; run it on the VM
#   bash infra/podman_api.sh stop && bash infra/podman_api.sh start   # the container then mounts it read-only and works offline
#
# The revision is pinned, so the files are the ones that were measured (docs/CHATBOT.md). The API container never downloads anything:
# it mounts this folder read-only and sets HF_HUB_OFFLINE=1.
set -euo pipefail

IMAGE="${NEXUSZ_IMAGE:-registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x:latest}"
DATA_DIR="${NEXUSZ_DATA_DIR:-$HOME/data}"
TARGET="${NEXUSZ_INTENT_DIR:-$DATA_DIR/granite-embedding-30m-english}"
REVISION="9b5b096411652ec1189c68fcfb90d0a82c5b45af"      # ibm-granite/granite-embedding-30m-english, last changed 2025-08-22

mkdir -p "$TARGET"
podman run --rm --userns=keep-id:uid=1000,gid=1000 -v "$TARGET:/target:rw,z" -e HF_HOME=/tmp/hf --tmpfs /tmp "$IMAGE" \
  /opt/venv/bin/python -c "
from huggingface_hub import snapshot_download
snapshot_download('ibm-granite/granite-embedding-30m-english', revision='$REVISION', local_dir='/target',
                  allow_patterns=['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'vocab.json', 'merges.txt', 'special_tokens_map.json', '1_Pooling/config.json', 'modules.json'])
"
sha256sum "$TARGET/model.safetensors"
echo "ready: $TARGET  (restart the API: bash infra/podman_api.sh stop && bash infra/podman_api.sh start)"
