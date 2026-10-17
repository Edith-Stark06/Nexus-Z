#!/usr/bin/env bash
# Measure what the IBM Z on-chip AI accelerator (NNPA) really does, using the processor's own counters.
#
#   bash infra/accel_counters.sh
#
# Run it on the LinuxONE VM as the normal user (sudo is used only for `perf`). It runs three workloads from ml/accel_probe.py inside the
# platform container, one after another: a TensorFlow network, IBM Granite through llama.cpp, and XGBoost trees as the control.
# While each runs, `perf stat` reads the pai_ext NNPA counters for the whole machine, so the VM must otherwise be idle.
#
# What this proves: that the network's matrix multiplications and Granite's were executed by the NNPA facility, and that trees
# were not. What it does not prove: that NEXUS Z uses the accelerator. Our detection model is trees on the CPU; see ml/accel_probe.py.
#
# Needs: perf (sudo dnf install perf), the platform container named "notebook", this repo at ~/Nexus-Z.
set -euo pipefail

CONTAINER="${NEXUSZ_CONTAINER:-notebook}"
EVENTS=(NNPA_ALL NNPA_MATMUL_OP NNPA_SIGMOID)
perf_events=(); for e in "${EVENTS[@]}"; do perf_events+=(-e "pai_ext/$e/"); done

command -v perf >/dev/null || { echo "perf is not installed (sudo dnf install perf)" >&2; exit 1; }
ls /sys/bus/event_source/devices/pai_ext >/dev/null 2>&1 || { echo "this machine has no pai_ext counters" >&2; exit 1; }
out="$(mktemp -d)"; trap 'rm -rf "$out"' EXIT

for mode in trees dense granite; do
  echo "running $mode ..." >&2
  sudo perf stat -a "${perf_events[@]}" -x, -o "$out/$mode.csv" -- \
    sudo -u "$USER" env XDG_RUNTIME_DIR="/run/user/$(id -u)" \
    podman exec -w /home/ibm-user/Nexus-Z -e PYTHONPATH=/home/ibm-user/Nexus-Z "$CONTAINER" \
    python -m ml.accel_probe "$mode" 2>/dev/null | grep RESULT | tee "$out/$mode.txt" >/dev/null || true
done

echo
printf "%-9s %-34s" "workload" "speed"
for e in "${EVENTS[@]}"; do printf " %16s" "${e#NNPA_}"; done; echo
for mode in trees dense granite; do
  speed="$(sed -E 's/RESULT [a-z]+ //; s/_/ /g' "$out/$mode.txt")"
  printf "%-9s %-34s" "$mode" "$speed"
  for e in "${EVENTS[@]}"; do
    printf " %16s" "$(grep "pai_ext/$e/" "$out/$mode.csv" | cut -d, -f1)"
  done; echo
done
echo
echo "Counts are NNPA operations executed machine-wide while each workload ran (processor counters, pai_ext). Trees must show 0."
