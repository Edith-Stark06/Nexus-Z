#!/usr/bin/env bash
# Show that the neural scorer runs on the IBM Z on-chip AI accelerator (NNPA), and that the trees do not.
#
#   bash infra/accel_counters.sh [bundle folder inside the container] [slice name]
#
# Run it on the LinuxONE VM as the normal user (it uses sudo only for `perf`). It scores real payments twice inside the
# platform container, once with the XGBoost trees and once with the neural network, while `perf stat` reads the
# processor's own NNPA counters (the pai_ext events) for the whole machine. The VM should be idle: the counters are
# system-wide, so another job using the accelerator would be counted too.
#
# Needs: perf (sudo dnf install perf), the platform container named "notebook", this repo at ~/Nexus-Z.
set -euo pipefail

BUNDLE="${1:-/home/ibm-user/data/models/HI-Small-pig}"
SLICE="${2:-HI-Pig-Slice}"
CONTAINER="${NEXUSZ_CONTAINER:-notebook}"
EVENTS=(NNPA_ALL NNPA_MATMUL_OP NNPA_SIGMOID NNPA_RELU)
perf_events=(); for e in "${EVENTS[@]}"; do perf_events+=(-e "pai_ext/$e/"); done

command -v perf >/dev/null || { echo "perf is not installed (sudo dnf install perf)" >&2; exit 1; }
ls /sys/bus/event_source/devices/pai_ext >/dev/null 2>&1 || { echo "this machine has no pai_ext counters" >&2; exit 1; }
out="$(mktemp -d)"; trap 'rm -rf "$out"' EXIT

for mode in trees network; do
  sudo perf stat -a "${perf_events[@]}" -x, -o "$out/$mode.csv" -- \
    sudo -u "$USER" env XDG_RUNTIME_DIR="/run/user/$(id -u)" \
    podman exec -w /home/ibm-user/Nexus-Z -e NEXUSZ_DATA_DIR=/home/ibm-user/data "$CONTAINER" \
    python -m ml.accel_check "$mode" "$BUNDLE" "$SLICE" | tee "$out/$mode.txt" | grep -E "RESULT|PARITY|payments from" || true
done

echo
printf "%-9s %16s %18s" "scorer" "payments/second" "NNPA operations"
for e in "${EVENTS[@]:1}"; do printf " %18s" "${e#NNPA_}"; done; echo
for mode in trees network; do
  rate="$(grep RESULT "$out/$mode.txt" | sed -E 's/.*payments_per_second ([0-9,]+).*/\1/')"
  printf "%-9s %16s" "$mode" "$rate"
  for e in "${EVENTS[@]}"; do
    printf " %18s" "$(grep "pai_ext/$e/" "$out/$mode.csv" | cut -d, -f1)"
  done; echo
done
echo
echo "Counts come from the processor's pai_ext counters, machine-wide, while each scorer ran. Trees must show 0."
