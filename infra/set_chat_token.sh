#!/usr/bin/env bash
# Store the Hugging Face token for the assistant as a podman secret, on the LinuxONE VM.
#
#   bash infra/set_chat_token.sh           # asks for the token, hidden as you type it
#   bash infra/set_chat_token.sh --remove  # forget it; the assistant then answers by rules
#
# Run it ON THE VM, in your own terminal. Never paste the token into a chat, a file in the repository, a command line or an environment
# variable: the repository is public, a command line is kept in shell history, and an environment variable shows up in `podman inspect`.
# Make the token at https://huggingface.co/settings/tokens : a fine-grained token with only "Make calls to Inference Providers".
# Then restart the API so the container mounts it:  bash infra/podman_api.sh stop && bash infra/podman_api.sh start
set -euo pipefail

SECRET="${NEXUSZ_CHAT_SECRET:-nexusz_hf_token}"

if [ "${1:-}" = "--remove" ]; then
  podman secret rm "$SECRET" && echo "removed $SECRET"
  exit 0
fi

[ -t 0 ] || { echo "run this in an interactive terminal so the token is typed hidden, not piped" >&2; exit 1; }
read -r -s -p "Hugging Face token (hidden): " TOKEN
echo
[ -n "$TOKEN" ] || { echo "no token entered" >&2; exit 1; }
case "$TOKEN" in
  hf_*) ;;
  *) echo "warning: Hugging Face tokens start with hf_; stored anyway" >&2 ;;
esac
podman secret rm "$SECRET" >/dev/null 2>&1 || true
printf '%s' "$TOKEN" | podman secret create "$SECRET" - >/dev/null
unset TOKEN
echo "stored as the podman secret $SECRET (not in any file of the repository)."
echo "now: bash infra/podman_api.sh stop && bash infra/podman_api.sh start && bash infra/podman_api.sh check"
