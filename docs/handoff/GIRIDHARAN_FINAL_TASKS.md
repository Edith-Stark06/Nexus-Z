# Giridharan: final tasks (read this first)

For Giridharan's Claude. Deadline: **Oct 18, 10:00 PM IST** for the Hack2Skill submission (virtual track); aim to have your PRs in by Oct 18, 14:00 IST so there is time to review them. Pull `main` before you start (`git pull origin main`), work on your branch `giridharan-re`, and open PRs to `main`. No attribution lines in commits or PR bodies. The repo is public: never commit keys, IP addresses, tokens or data files.

## What changed since your last PR

- Ramana squash-merged your PR #14 and measured it. The rebuild with the **payment-level model** was slower than your account-model numbers (about 33 s on a laptop). The cause was describing all rings, so PR #17 (`ml/service.py`, not your files) made that step 16.6 s to 1.8 s with identical output.
- Ramana ran your `infra/bench.py` on the idle VM with the committed payment bundle: first state 15.3 s, a new payment visible in 12.3 to 12.6 s, idle p50 2 to 3 ms, oldest state under load 36 s. It is in `docs/PLATFORM_RESULTS.md` section 3b. **Do not re-run the benchmark** and do not quote the older freshness numbers (about 15 s, account model) for the current model.
- Under load, 761 of 4,159 `GET /rings/{id}` calls returned 404, because a ring id is a hash of its members and changes when a rebuild regrows or splits a ring. This is expected behaviour, not a server error. Tushar's dashboard should reload the list on a 404. If you want to help: tell Tushar, and do not change the id scheme this late.

## The demo to record

The demo you record is the one in **`docs/DEMO.md`** (read it first): the API on the VM serving the synthetic pig-butchering slice with the typology bundle (`ml/artifacts/HI-Small-pig`), an SSH tunnel to a laptop, the dashboard, and `infra.simulator replay --speed 600` streaming payments. Ramana dress-rehearsed it on the VM: first state 16 s, 209,126 payments in about 3 minutes, 12 refreshes, rebuilds of 11 to 16 s. Tushar is fixing the dashboard wording (`docs/handoff/TUSHAR_DEMO_FIXES.md`); record the final video **after** his PR is merged. Screenshots of the VM (tasks 1) do not depend on him. Replace the "API running" and "rings and reasons" commands below with the ones in `docs/DEMO.md` (`NEXUSZ_SLICE=HI-Pig-Slice`, `NEXUSZ_BUNDLE=.../ml/artifacts/HI-Small-pig`).

## Your tasks, in this order

### 1. Screenshots (needed for judging criterion 3, "containerization, security, scalability, compute")

Take them on the VM with the real model running. Ask Ramana for the VM address and key; do not put them in the repo. Ramana's training jobs are finished, but **tell Ramana before you start the API**, so nothing else is using the VM. Save the images under `docs/evidence/` with the names below (small PNGs, no tokens or IPs visible; crop or blur them).

| File | What it shows | How |
|---|---|---|
| `01_jupyter_container.png` | The platform Jupyter Lab ML container running under rootless Podman | `podman ps` |
| `02_loopback_only.png` | Jupyter and the API listen on 127.0.0.1 only | `ss -ltn` |
| `03_default_token_403.png` | The platform's published default token is rejected (HTTP 403) | `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:38888/api/status?token=Your_Token1"` should print 403 (never show the real token in `~/.jupyter_token`) |
| `04_tests_on_vm.png` | Tests pass on s390x | `bash infra/setup_vm.sh --check --tests` or `python -m pytest ml/tests api/tests infra/tests -q` in `~/nexusz-venv` |
| `05_api_running.png` | The API serving the real model, in its container | `bash infra/podman_api.sh start`, wait 30 s, then `bash infra/podman_api.sh status` (it prints `/health`: `backend: model`) |
| `06_rings_and_reasons.png` | A ring with its reasons from the API | `curl -s http://127.0.0.1:8000/rings` and one `/rings/{id}` |
| `07_bench_result.png` | The idle-VM numbers | `cat` of the section 3b table in `docs/PLATFORM_RESULTS.md` (do not re-run `bench.py`) |
| `08_training_log.png` | Payment model trained on the VM (882 s) | the saved log under `~/shared` if it still exists; otherwise skip and say so |
| `09_container_security.png` | The API container is locked down: loopback only, non-root, read-only filesystem and mounts, no capabilities, memory limit, writes refused | `bash infra/podman_api.sh check` (one screen; take it as is) |
| `10_accelerator_counters.png` | The processor's own counters: trees use the accelerator 0 times, a neural network and Granite thousands | stop any replay, then `bash infra/accel_counters.sh` (about 3 minutes; the VM must be idle). This measures the platform; it does **not** mean NEXUS Z detection runs on it |

Write `docs/evidence/README.md` listing each file with the exact command and the date. If a command fails or the output differs from what the docs say, **tell Ramana; do not edit the numbers in the docs**.

### 2. Video script (3 minutes at most, the guidebook is strict)

Required content: the problem, the data behind it, the solution, how it uses IBM Z (tech stack), and **showing the LinuxONE instance and the model**. Put it in `docs/VIDEO_SCRIPT.md` as a two-column table: time, what is on screen, and what is said, with word counts that fit 3:00 at about 150 words per minute (about 430 words in total). Suggested split: 0:00 to 0:30 problem (pig-butchering rings and the next victim), 0:30 to 1:00 data and approach, 1:00 to 2:15 live: VM, container, model, a ring and its explanation on the dashboard, 2:15 to 2:50 results and LinuxONE use, 2:50 to 3:00 close. Ramana speaks the ML part, Tushar the pitch and dashboard.

Use only claims the repo supports. Take every number from `docs/ML_RESULTS.md`, `docs/PLATFORM_RESULTS.md` or `docs/TECHNICAL_DESIGN.md`, and name the source next to it in the script's notes column.

### 3. Already done by Ramana: the API in a container

`infra/podman_api.sh` now runs the API in a hardened rootless container from the platform image (the Containerfile cannot be built on this VM; the script explains why). It is verified: first state 12 s, the security settings are checked from inside by `check`. The numbers are in `docs/PLATFORM_RESULTS.md`. Your job is only the screenshots 05 and 09.

## Claims we must not make

- **No accelerator speed-up for our model.** XGBoost, pandas and NetworkX run on CPU. The accelerator is present on the VM and used by the platform's own generative lab only.
- Rings are not "incremental". Scoring is a full recompute in micro-batches.
- The pig-butchering rings used to test the typology are synthetic, generated by our own team (`data/rings.py`), so say "simulated" when you mention them. Most laundering groups in IBM AML are still missed (see `docs/ML_RESULTS.md` caveats).
- Do not say a transaction is flagged "instantly". Say about 12 seconds on the idle VM.

## Send Ramana, when done

A short message: what is merged, what you could not do, and anything that did not match the docs.
