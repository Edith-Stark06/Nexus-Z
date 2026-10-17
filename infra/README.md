# NEXUS Z platform: setup, deployment, simulator, benchmark

Workstream C. Everything here was written and tested on a Windows laptop (Python 3.14). Parts were then run on the LinuxONE VM (2026-10-17, while
Ramana's training jobs were using it); each step below says what was and was not verified there.
Nothing marked "not yet run on the VM" has been verified.

| Piece | File | Status |
|---|---|---|
| Backend switch, background refresh, health | `api/backend.py`, `api/async_backend.py`, `api/main.py` | tested locally (unit, local integration) |
| Streaming simulator | `infra/simulator.py` | tested locally |
| Benchmark | `infra/bench.py` | run locally; **VM run pending**: needs an idle VM (`docs/PLATFORM_RESULTS.md`) |
| VM environment script | `infra/setup_vm.sh` | **`--check --tests` run on the VM: environment OK, 102 passed / 4 skipped, parity identical.** The install path (dnf, pandas and XGBoost builds) has **not** been exercised: the environment already existed |
| API without a container | `infra/run_api.sh`, `infra/nexusz-api.service` | **`run_api.sh` run on the VM (foreground): `/health` answered, model backend served rings, replay worked.** The systemd unit has **not** been installed or tested |
| API in Podman | `infra/Containerfile`, `infra/podman_api.sh` | **not yet built or run on the VM. Do not claim containers until it has been** |

## Target environment (from the handoff)

IBM LinuxONE Community Cloud VM: RHEL 9.8, **s390x (big-endian)**, 3 vCPUs, about 7.5 GB RAM, Python 3.12, Podman 5.8.2
(no Docker). numpy 1.24.4 and scipy 1.11.1 come from RHEL packages; pandas 2.2.3 and XGBoost 3.4.1 are compiled from
source; scikit-learn, SHAP and numba do not build there and are not used. Serve a **time slice, not the full file**
(memory).

## 1. Environment on the VM

Ramana's VM already has `~/nexusz-venv`, `~/bundle`, `~/reference.csv` and a 48-hour slice. Access (address, key) is
not in this repository; ask Ramana. Then:

```bash
git clone https://github.com/Edith-Stark06/Nexus-Z.git ~/Nexus-Z      # or: cd ~/Nexus-Z && git fetch && git checkout giridharan-re
cd ~/Nexus-Z
bash infra/setup_vm.sh --check --tests     # verify the existing environment, run tests and the parity check; changes nothing
bash infra/setup_vm.sh                     # install whatever is missing (RPMs, venv, pandas, XGBoost, API packages), then verify
```

What the script does, in order: checks the architecture (refuses anything but s390x unless `NEXUSZ_ALLOW_OTHER_ARCH=1`)
and logs OS, CPUs, memory; installs only missing RPMs with `sudo -n dnf` (python3.12 and -devel, numpy, scipy, gcc, g++,
cmake, ninja-build, git); reuses `~/nexusz-venv` (it refuses, and does not delete, a venv made without
`--system-site-packages`); checks numpy 1.24.4 and scipy 1.11.1 come from RHEL; builds pandas 2.2.3 with
`pip install --no-deps --no-build-isolation` after installing Cython 3.0.x, meson-python, meson and versioneer; builds
XGBoost 3.4.1; installs `api/requirements.txt` plus networkx under a constraints file that keeps numpy and scipy fixed;
verifies versions and a native `xgboost.Booster` round trip. Log: `~/nexusz-setup.log`. Settings are environment
variables listed at the top of the script.

Caveats, so nobody is surprised:
- The XGBoost step is `pip install --no-deps xgboost==3.4.1` (a source build). Ramana's original `~/setup_env2.sh` was
  not available when this was written. If the build fails, compare with that script and tell Giridharan.
- The pandas and XGBoost compiles take a long time on 3 vCPUs and need about 1.5 GB of free memory.
- `pip check` will report that pandas 2.2.3 wants numpy 1.26 on Python 3.12; the RHEL numpy 1.24.4 is what the tested
  environment uses (`--no-deps`).
- Measured on the VM (2026-10-17): `ml/tests api/tests infra/tests` gives 102 passed, 4 skipped (the skips need
  scikit-learn or SHAP, which the VM does not have).
- Parity: `python -m ml.latency_check check ~/bundle ~/reference.csv` (the script runs it with `--tests`).

## 2. Run the API

Settings are environment variables. Defaults give the **stub** backend (invented sample data, no files needed).

| Variable | Default | Meaning |
|---|---|---|
| `NEXUSZ_BACKEND` | `stub` | `stub` or `model`. Anything else is an error |
| `NEXUSZ_SLICE` | `HI-Slice` | slice name; file is `<NEXUSZ_DATA_DIR>/ibm-aml/<slice>_Trans.csv` |
| `NEXUSZ_DATA_DIR` | see `data/paths.py` | dataset folder |
| `NEXUSZ_BUNDLE` | `ml/artifacts/HI-Small` | folder with `model.json` and `meta.json` |
| `NEXUSZ_HISTORY_HOURS` | unset (whole slice) | use only the first N hours as history (for the replay demo) |
| `NEXUSZ_ACTIVE_HOURS` | `24` | accounts active in the last N hours are scored |
| `NEXUSZ_MIN_REFRESH_SECONDS` | `5` | least time between rebuilds of the served state |
| `NEXUSZ_CORS_ORIGINS` | none | extra comma-separated origins (3000 and 5173 on localhost and 127.0.0.1 are always allowed) |
| `NEXUSZ_HOST` / `NEXUSZ_PORT` | `127.0.0.1` / `8000` | used by `infra/run_api.sh` and `infra/podman_api.sh` |

A bad value (unknown backend, missing bundle or slice, unreadable bundle, non-numeric number) stops the server at
startup with a message that says what to fix. **It never falls back to the stub.**

```bash
# stub (no data needed)
uvicorn api.main:app --port 8000

# real model over the 48-hour slice (foreground)
export NEXUSZ_BACKEND=model NEXUSZ_DATA_DIR=~/data NEXUSZ_BUNDLE=~/bundle
bash infra/run_api.sh
curl -fsS http://127.0.0.1:8000/health
```

`/health` in model mode (illustrative values):

```json
{"status": "ok", "backend": "model", "refresh_mode": "background micro-batch rebuild",
 "refresh_interval_seconds": 5.0, "state_age_seconds": 3.1, "last_rebuild_seconds": 15.4,
 "data_as_of": "2022-09-10T00:01:00+00:00", "history_transactions": 654467, "pending_transactions": 0,
 "refreshing": false, "refreshes_completed": 1, "last_error": null}
```

`status` becomes `"degraded"` (still HTTP 200, last good state still served) if the latest refresh failed;
`last_error` then holds the exception type and time only (details are in the server log). In stub mode `/health` is
exactly `{"status": "ok", "backend": "stub"}`.

### How refresh works (and what it is not)

`POST /transactions` queues rows and returns immediately. One background thread rebuilds features, scores and rings
for **all** history plus the queued rows, no more often than every `NEXUSZ_MIN_REFRESH_SECONDS` seconds, describes
every ring, and then publishes the finished result with one reference swap. Requests only ever read a finished
snapshot, so they never wait for a rebuild and never see a half-built one. If a rebuild fails, the queued rows go back
in the queue and the old snapshot keeps being served. This is **micro-batch rescoring, not per-transaction
incremental scoring**: a transaction affects `/rings` after the next rebuild completes (interval plus rebuild time;
measured in `docs/PLATFORM_RESULTS.md`). An account that was only just ingested returns 404 until then.

### Deployment options on the VM (choose one; say which in the submission)

**A. systemd user service, no container (simplest).**
```bash
mkdir -p ~/.config/systemd/user ~/.config/nexusz
cp infra/nexusz-api.service ~/.config/systemd/user/ && cp infra/api.env.example ~/.config/nexusz/api.env   # edit api.env
systemctl --user daemon-reload && systemctl --user enable --now nexusz-api
systemctl --user status nexusz-api; journalctl --user -u nexusz-api -f      # logs
systemctl --user restart nexusz-api; systemctl --user stop nexusz-api
```
If you use this, **do not claim Docker or containers.**

**B. Podman, on the LinuxONE Jupyter image.**
```bash
bash infra/podman_api.sh build && bash infra/podman_api.sh start
bash infra/podman_api.sh status         # also curls /health
bash infra/podman_api.sh logs; bash infra/podman_api.sh stop
```
Binds the VM's loopback only (`127.0.0.1:$NEXUSZ_PORT`), mounts the repo, data and model read-only, and touches only the
container named `nexusz-api` (not the Jupyter container, which uses port 38888). Not yet built on the VM: the base
image's package state and pip permissions are assumptions to check on the first run.

Reach the API from your own computer through an SSH tunnel, as for Jupyter, rather than opening a port:
`ssh -L 8000:127.0.0.1:8000 <user>@<vm address>`. The API has no authentication.

## 3. The streaming demo

Scenario: the API starts with the **first 24 hours** of the slice as history; the simulator replays the rest through
the real `POST /transactions`, so rings and alerts change while the dashboard (or `curl`) watches. Order is the file
order; there is no randomness, so every run is identical.

```bash
# once: the slice (needs the 450 MB HI-Small file; or copy the existing slice on the VM)
python -m ml.make_slice HI-Small 48 HI-Slice
# once: the replay file = everything after the first 24 hours, in API format. Not committed (it is data).
python -m infra.simulator prepare --slice HI-Slice --history-hours 24 --out ~/nexusz-replay.csv

# 1. start the API with the matching history window
export NEXUSZ_BACKEND=model NEXUSZ_DATA_DIR=~/data NEXUSZ_BUNDLE=~/bundle NEXUSZ_HISTORY_HOURS=24
bash infra/run_api.sh &                       # wait until /health answers (about 15 s at 654k history rows on a laptop)
curl -fsS http://127.0.0.1:8000/health

# 2. look at the starting state
curl -s http://127.0.0.1:8000/rings | head -c 600
RING=$(curl -s http://127.0.0.1:8000/rings | python -c "import json,sys;print(json.load(sys.stdin)[0]['ring_id'])")
curl -s http://127.0.0.1:8000/rings/$RING | head -c 800
curl -s "http://127.0.0.1:8000/alerts?limit=5"

# 3. replay: 3600 data seconds per wall second = one data hour per second
python -m infra.simulator replay --input ~/nexusz-replay.csv --url http://127.0.0.1:8000 --batch-size 500 --speed 3600

# 4. watch the effect; state_age_seconds and refreshes_completed show the refreshes
watch -n 2 'curl -s http://127.0.0.1:8000/health'
curl -s http://127.0.0.1:8000/rings | head -c 600
```

Simulator options (`python -m infra.simulator replay --help`): `--batch-size` (1 to 5000, the API's limit), `--speed`
(data seconds per wall second, 0 = as fast as possible), `--delay` (extra seconds per batch), `--max` (stop after N
valid rows), `--start-row` (skip N data rows first), `--timeout`, `--retries` (timeouts and 429/502/503/504 only,
default 2), `--max-failures` (abort after N failed batches in a row). It prints a JSON summary: `accepted` is only what
the API answered, `rejected` is what it refused, `failed` is what never got an answer after the retries, and
`skipped_malformed` rows are never sent. Exit code 0 means nothing was rejected or lost.

**Payment pre-check ("Check before you send").** `GET /accounts/{destination}` is enough: `ring_id`, `role`, `risk`
and `reasons` for a destination that is in a flagged ring; `ring_id: null` for one that is not; **404 means the API has
no information about that account, which is not the same as "safe"**. `GET /alerts` carries `victim_warning` entries
for accounts that paid into a flagged ring in the last 48 hours. That rule has not been evaluated; word the screen as
"potential risk, review recommended", never as a verdict.

### Reset and stop

Nothing is persisted: the served history lives in the API process's memory. **To reset the demo, stop and restart the
API** (`kill` the process, `systemctl --user restart nexusz-api`, or `bash infra/podman_api.sh stop && ... start`), then
replay again. This does not touch the slice, the replay file or the model. Replaying twice into the same running API
ingests every row twice, so restart between runs. Stop with Ctrl-C / `kill <pid>` (shutdown stops the refresh thread;
a rebuild already in progress is abandoned, not published).

## 4. Benchmark

```bash
python -m infra.bench --url http://127.0.0.1:8000 --replay ~/nexusz-replay.csv --pid <server pid> --out ~/bench.json
```
Four phases (idle latency, ingest throughput, latency under load with refreshes running, freshness). It adds replay
rows and probe transactions to the running API, so restart the API afterwards. Results and method:
`docs/PLATFORM_RESULTS.md`. Stop other jobs on the VM first, or the numbers include them.

## Tests

```bash
python -m pytest ml/tests api/tests infra/tests -q
```
Locally the one skip is the SHAP comparison (SHAP is not installed). See `docs/PLATFORM_RESULTS.md` for the counts of
each run.

## Known limits

- Rebuild cost grows with history (full recompute, not incremental). Ingested rows are kept forever, so a long-running
  demo grows its history; restart to reset.
- Ingested rows are assumed to be US dollars (the API has no currency field), but the slice mixes currencies.
  `total_amount` and edge amounts must not be shown as dollars.
- Ring ids are a hash of the member list: a ring that gains a member gets a new id.
- Roles are inferred from graph position, not labelled. Ring `risk` favors small rings.
- Account ids from a slice differ from ids in the full dataset and in `ml/artifacts/HI-Small/examples/`.
- No deduplication of `tx_id`; no authentication; the pending queue is unbounded (batch size is capped at 5000 per request).
