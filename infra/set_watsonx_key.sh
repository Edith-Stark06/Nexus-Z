#!/usr/bin/env bash
# Store the IBM Cloud API key for watsonx.ai as a podman secret, on the LinuxONE VM.
#
#   bash infra/set_watsonx_key.sh           # asks for the key, hidden as you type it
#   bash infra/set_watsonx_key.sh --remove  # forget it
#
# Run it ON THE VM, in your own terminal. Never paste the key into a chat, a file in the repository, a command line or an environment variable.
# The key is made at https://cloud.ibm.com/iam/apikeys . The region URL (for example https://eu-de.ml.cloud.ibm.com) and the watsonx.ai project id
# are not secrets; pass them when starting the API:
#   NEXUSZ_WATSONX_URL=https://eu-de.ml.cloud.ibm.com NEXUSZ_WATSONX_PROJECT_ID=<project id> bash infra/podman_api.sh start
set -euo pipefail

SECRET="${NEXUSZ_WATSONX_SECRET:-nexusz_watsonx_key}"

if [ "${1:-}" = "--remove" ]; then
  podman secret rm "$SECRET" && echo "removed $SECRET"
  exit 0
fi

[ -t 0 ] || { echo "run this in an interactive terminal so the key is typed hidden, not piped" >&2; exit 1; }
read -r -s -p "IBM Cloud API key (hidden): " KEY
echo
[ -n "$KEY" ] || { echo "no key entered" >&2; exit 1; }
podman secret rm "$SECRET" >/dev/null 2>&1 || true
printf '%s' "$KEY" | podman secret create "$SECRET" - >/dev/null
unset KEY
echo "stored as the podman secret $SECRET (not in any file of the repository)."
echo "now: NEXUSZ_WATSONX_URL=<region url> NEXUSZ_WATSONX_PROJECT_ID=<project id> bash infra/podman_api.sh stop && NEXUSZ_WATSONX_URL=<region url> NEXUSZ_WATSONX_PROJECT_ID=<project id> bash infra/podman_api.sh start"
