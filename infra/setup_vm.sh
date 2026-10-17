#!/usr/bin/env bash
# Reproduce the NEXUS Z serving environment on the LinuxONE VM (RHEL 9, s390x, Python 3.12).
#
#   bash infra/setup_vm.sh              # install what is missing, then verify
#   bash infra/setup_vm.sh --check      # verify only; changes nothing
#   bash infra/setup_vm.sh --check --tests   # verify, then run the tests and the model parity check
#
# Safe to rerun: every step first checks whether it is already done. It never deletes or overwrites an
# existing virtualenv, data file or model. It does not install scikit-learn, SHAP or numba (they do not
# build on s390x and the serving code does not need them).
#
# Settings (environment variables, all optional):
#   NEXUSZ_VENV        virtualenv location                    default ~/nexusz-venv
#   NEXUSZ_REPO        checkout of the repo (for tests)       default ~/Nexus-Z
#   NEXUSZ_BUNDLE_DIR  model folder for the parity check      default ~/bundle
#   NEXUSZ_REFERENCE   reference CSV for the parity check    default ~/reference.csv
#   NEXUSZ_LOG         log file                               default ~/nexusz-setup.log
#   NEXUSZ_ALLOW_OTHER_ARCH=1   allow running on a non-s390x machine (for a dry run of the logic)
set -euo pipefail

VENV="${NEXUSZ_VENV:-$HOME/nexusz-venv}"
REPO="${NEXUSZ_REPO:-$HOME/Nexus-Z}"
BUNDLE_DIR="${NEXUSZ_BUNDLE_DIR:-$HOME/bundle}"
REFERENCE="${NEXUSZ_REFERENCE:-$HOME/reference.csv}"
LOG="${NEXUSZ_LOG:-$HOME/nexusz-setup.log}"
PY="${NEXUSZ_PYTHON:-python3.12}"

# Versions from the handoff (docs/handoff/HANDOFF_GIRIDHARAN.md, Task 1). Do not change without testing on the VM.
NUMPY_VERSION=1.24.4      # from RHEL (python3.12-numpy)
SCIPY_VERSION=1.11.1      # from RHEL (python3.12-scipy)
PANDAS_VERSION=2.2.3      # compiled from source
XGBOOST_VERSION=3.4.1     # compiled from source
# Build tools for the pandas source build. The isolated build picked a Cython that was too old, so these go in
# first and pandas is built with --no-build-isolation. The meson pair are the versions pandas 2.2.3 itself pins.
PANDAS_BUILD_DEPS=("Cython>=3.0.5,<3.1" "meson-python==0.13.1" "meson==1.2.1" "versioneer[toml]" "wheel" "setuptools")
DNF_PACKAGES=(python3.12 python3.12-devel python3.12-pip python3.12-numpy python3.12-scipy
              gcc gcc-c++ make cmake ninja-build git)

CHECK_ONLY=0; RUN_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --tests) RUN_TESTS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$LOG")"
log()  { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG" >&2; }
die()  { log "ERROR: $*"; exit 1; }
step() { log "== $*"; }
trap 'log "setup stopped at line $LINENO (exit $?); details are in $LOG"' ERR

# Run a command, appending its output to the log; show the tail on failure.
run() {
  log "+ $*"
  if ! "$@" >>"$LOG" 2>&1; then
    log "command failed: $*"; tail -n 25 "$LOG" >&2; return 1
  fi
}

pyver() { "$VENV/bin/python" -c "import importlib.metadata as m,sys;print(m.version(sys.argv[1]))" "$1" 2>/dev/null || true; }

# ---------------------------------------------------------------- 1. preflight
step "preflight"
arch="$(uname -m)"
log "architecture: $arch; kernel: $(uname -r)"
if [ "$arch" != "s390x" ] && [ "${NEXUSZ_ALLOW_OTHER_ARCH:-0}" != "1" ]; then
  die "this script reproduces the s390x LinuxONE environment; running on $arch. Set NEXUSZ_ALLOW_OTHER_ARCH=1 to continue anyway"
fi
if [ -r /etc/os-release ]; then
  . /etc/os-release
  log "OS: ${PRETTY_NAME:-unknown}"
  case "${ID:-}:${VERSION_ID:-}" in rhel:9*|rocky:9*|almalinux:9*|centos:9*) ;; *) log "WARNING: tested on RHEL 9.x only" ;; esac
fi
log "CPUs: $(nproc); memory: $(awk '/MemTotal/ {printf "%.1f GB", $2/1048576}' /proc/meminfo); free disk in \$HOME: $(df -h --output=avail "$HOME" | tail -1 | tr -d ' ')"
if [ "$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)" -lt 1500 ]; then
  log "WARNING: under 1.5 GB of memory available; the pandas and XGBoost compiles may be killed. Stop other jobs first."
fi
if podman ps --format '{{.Names}}' 2>/dev/null | grep -q .; then
  log "running containers (left untouched): $(podman ps --format '{{.Names}}' | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 2. system packages
step "system packages"
missing=()
for p in "${DNF_PACKAGES[@]}"; do rpm -q "$p" >/dev/null 2>&1 || missing+=("$p"); done
if [ "${#missing[@]}" -eq 0 ]; then
  log "all required RPMs are installed"
elif [ "$CHECK_ONLY" = 1 ]; then
  log "RPMs not installed: ${missing[*]} (a normal run installs them; they matter only for rebuilding pandas or XGBoost, so an existing working environment is not affected)"
else
  command -v dnf >/dev/null || die "dnf not found; install manually: ${missing[*]}"
  sudo -n true 2>/dev/null || die "need passwordless sudo to install: ${missing[*]} (or ask an admin to install them)"
  run sudo -n dnf -y install "${missing[@]}"
fi
command -v "$PY" >/dev/null || die "$PY not found; install python3.12 (dnf install python3.12 python3.12-devel)"
log "python: $("$PY" --version)"

# ---------------------------------------------------------------- 3. virtualenv
step "virtualenv $VENV"
if [ -x "$VENV/bin/python" ]; then
  grep -qi '^include-system-site-packages *= *true' "$VENV/pyvenv.cfg" \
    || die "$VENV exists but was not created with --system-site-packages, so it cannot see the RHEL numpy/scipy. Move it aside or set NEXUSZ_VENV to a new path (this script will not delete it)"
  log "reusing existing virtualenv (python $("$VENV/bin/python" --version 2>&1 | cut -d' ' -f2))"
elif [ "$CHECK_ONLY" = 1 ]; then
  die "virtualenv $VENV does not exist (run without --check)"
else
  run "$PY" -m venv --system-site-packages "$VENV"
fi
PIP=("$VENV/bin/python" -m pip)
CONSTRAINTS="$VENV/nexusz-constraints.txt"
if [ "$CHECK_ONLY" = 0 ]; then
  printf 'numpy==%s\nscipy==%s\n' "$NUMPY_VERSION" "$SCIPY_VERSION" >"$CONSTRAINTS"   # keeps pip off the RHEL builds
fi

# ---------------------------------------------------------------- 4. numpy / scipy (RHEL builds)
step "numpy and scipy from RHEL"
[ "$(pyver numpy)" = "$NUMPY_VERSION" ] || die "numpy is '$(pyver numpy)', expected $NUMPY_VERSION from python3.12-numpy. Do not pip install numpy: PyPI has no s390x wheel and the source build is slow and fragile"
[ "$(pyver scipy)" = "$SCIPY_VERSION" ] || die "scipy is '$(pyver scipy)', expected $SCIPY_VERSION from python3.12-scipy"
log "numpy $NUMPY_VERSION, scipy $SCIPY_VERSION"

# ---------------------------------------------------------------- 5. pandas (source build)
step "pandas $PANDAS_VERSION"
if [ "$(pyver pandas)" = "$PANDAS_VERSION" ]; then
  log "already installed"
elif [ "$CHECK_ONLY" = 1 ]; then
  log "MISSING: pandas $PANDAS_VERSION"
else
  log "building pandas from source; this takes a long time on 3 vCPUs (progress is in $LOG)"
  run "${PIP[@]}" install -c "$CONSTRAINTS" "${PANDAS_BUILD_DEPS[@]}"
  run "${PIP[@]}" install -c "$CONSTRAINTS" --no-deps --no-build-isolation "pandas==$PANDAS_VERSION"
fi

# ---------------------------------------------------------------- 6. xgboost (source build)
step "xgboost $XGBOOST_VERSION"
if [ "$(pyver xgboost)" = "$XGBOOST_VERSION" ]; then
  log "already installed"
elif [ "$CHECK_ONLY" = 1 ]; then
  log "MISSING: xgboost $XGBOOST_VERSION"
else
  log "building xgboost from source (needs cmake and g++); progress is in $LOG"
  run "${PIP[@]}" install -c "$CONSTRAINTS" --no-deps "xgboost==$XGBOOST_VERSION"
fi

# ---------------------------------------------------------------- 7. pure-Python packages
step "API and test packages"
if [ "$CHECK_ONLY" = 0 ]; then
  req="$(dirname "$0")/../api/requirements.txt"
  [ -f "$req" ] || die "cannot find $req (run this script from a checkout of the repo)"
  run "${PIP[@]}" install -c "$CONSTRAINTS" -r "$req" "networkx>=3.0"
fi

# ---------------------------------------------------------------- 8. verify
step "verify"
fail=0
for spec in "numpy:$NUMPY_VERSION" "scipy:$SCIPY_VERSION" "pandas:$PANDAS_VERSION" "xgboost:$XGBOOST_VERSION"; do
  name="${spec%%:*}"; want="${spec##*:}"; got="$(pyver "$name")"
  if [ "$got" = "$want" ]; then log "ok       $name $got"; else log "MISMATCH $name: have '${got:-none}', want $want"; fail=1; fi
done
for name in fastapi uvicorn pydantic httpx pytest networkx; do
  got="$(pyver "$name")"; if [ -n "$got" ]; then log "ok       $name $got"; else log "MISSING  $name"; fail=1; fi
done
for name in scikit-learn shap numba; do
  [ -z "$(pyver "$name")" ] || log "note     $name is installed; serving does not use it"
done
"$VENV/bin/python" - >>"$LOG" 2>&1 <<'PY' || { log "IMPORT CHECK FAILED (see log)"; fail=1; }
import sys, sysconfig, numpy, scipy, pandas, xgboost, networkx, fastapi, pydantic
assert sys.byteorder in ("big", "little")
print("byteorder", sys.byteorder, "| platform", sysconfig.get_platform(), "| python", sys.version.split()[0])
# a tiny native-Booster round trip: the serving path uses xgboost.Booster, not XGBClassifier
import numpy as np
b = xgboost.train({"objective": "binary:logistic"}, xgboost.DMatrix(np.random.rand(50, 3), label=np.arange(50) % 2), 2)
assert b.predict(xgboost.DMatrix(np.random.rand(2, 3))).shape == (2,)
PY
grep -E 'byteorder' "$LOG" | tail -1 | while read -r line; do log "$line"; done
[ "$fail" = 0 ] || die "the environment does not match the documented one (details above)"
log "environment OK: activate with  source $VENV/bin/activate"

# ---------------------------------------------------------------- 9. optional: tests and parity
if [ "$RUN_TESTS" = 1 ]; then
  step "tests"
  [ -d "$REPO" ] || die "repo checkout $REPO not found (set NEXUSZ_REPO)"
  ( cd "$REPO" && "$VENV/bin/python" -m pytest ml/tests api/tests infra/tests -q ) 2>&1 | tee -a "$LOG" | tail -15 >&2
  step "model parity check"
  if [ -d "$BUNDLE_DIR" ] && [ -f "$REFERENCE" ]; then
    ( cd "$REPO" && "$VENV/bin/python" -m ml.latency_check check "$BUNDLE_DIR" "$REFERENCE" ) 2>&1 | tee -a "$LOG" >&2
  else
    log "SKIPPED parity check: need $BUNDLE_DIR and $REFERENCE (set NEXUSZ_BUNDLE_DIR / NEXUSZ_REFERENCE)"
  fi
fi
log "done"
