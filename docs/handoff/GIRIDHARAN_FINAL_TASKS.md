# Giridharan: final tasks (read this first)

For Giridharan's Claude. Deadline: **Oct 18, 10:00 IST** for the Hack2Skill submission. Pull `main` before you start (`git pull origin main`), work on your branch `giridharan-re`, and open PRs to `main`. No attribution lines in commits or PR bodies. The repo is public: never commit keys, IP addresses, tokens or data files.

## What changed since your last PR

- Ramana squash-merged your PR #14 and measured it. The rebuild with the **payment-level model** was slower than your account-model numbers (about 33 s on a laptop). The cause was describing all rings, so PR #17 (`ml/service.py`, not your files) made that step 16.6 s to 1.8 s with identical output.
- Ramana ran your `infra/bench.py` on the idle VM with the committed payment bundle: first state 15.3 s, a new payment visible in 12.3 to 12.6 s, idle p50 2 to 3 ms, oldest state under load 36 s. It is in `docs/PLATFORM_RESULTS.md` section 3b. **Do not re-run the benchmark** and do not quote the older freshness numbers (about 15 s, account model) for the current model.
- Under load, 761 of 4,159 `GET /rings/{id}` calls returned 404, because a ring id is a hash of its members and changes when a rebuild regrows or splits a ring. This is expected behaviour, not a server error. Tushar's dashboard should reload the list on a 404. If you want to help: tell Tushar, and do not change the id scheme this late.

## Your tasks, in this order

### 1. Screenshots (needed for judging criterion 3, "containerization, security, scalability, compute")

Take them on the VM with the real model running. Ask Ramana for the VM address and key; do not put them in the repo. Ramana's training jobs are finished, but **tell Ramana before you start the API**, so nothing else is using the VM. Save the images under `docs/evidence/` with the names below (small PNGs, no tokens or IPs visible; crop or blur them).

| File | What it shows | How |
|---|---|---|
| `01_jupyter_container.png` | The platform Jupyter Lab ML container running under rootless Podman | `podman ps` |
| `02_loopback_only.png` | Jupyter and the API listen on 127.0.0.1 only | `ss -ltn` |
| `03_default_token_403.png` | The platform's published default token is rejected (HTTP 403) | `curl -s -o /dev/null -w "%{http_code}
" "http://127.0.0.1:38888/api/status?token=Your_Token1"` should print 403 (never show the real token in `~/.jupyter_token`) |
| `04_tests_on_vm.png` | Tests pass on s390x | `bash infra/setup_vm.sh --check --tests` or `python -m pytest ml/tests api/tests infra/tests -q` in `~/nexusz-venv` |
| `05_api_running.png` | The API serving the real model | `bash infra/run_api.sh` with `NEXUSZ_BACKEND=model` (see `infra/api.env.example`), then `curl -s http://127.0.0.1:8000/health` |
| `06_rings_and_reasons.png` | A ring with its reasons from the API | `curl -s http://127.0.0.1:8000/rings` and one `/rings/{id}` |
| `07_bench_result.png` | The idle-VM numbers | `cat` of the section 3b table in `docs/PLATFORM_RESULTS.md` (do not re-run `bench.py`) |
| `08_training_log.png` | Payment model trained on the VM (882 s) | the saved log under `~/shared` if it still exists; otherwise skip and say so |

Write `docs/evidence/README.md` listing each file with the exact command and the date. If a command fails or the output differs from what the docs say, **tell Ramana; do not edit the numbers in the docs**.

### 2. Video script (3 minutes at most, the guidebook is strict)

Required content: the problem, the data behind it, the solution, how it uses IBM Z (tech stack), and **showing the LinuxONE instance and the model**. Put it in `docs/VIDEO_SCRIPT.md` as a two-column table: time, what is on screen, and what is said, with word counts that fit 3:00 at about 150 words per minute (about 430 words in total). Suggested split: 0:00 to 0:30 problem (pig-butchering rings and the next victim), 0:30 to 1:00 data and approach, 1:00 to 2:15 live: VM, container, model, a ring and its explanation on the dashboard, 2:15 to 2:50 results and LinuxONE use, 2:50 to 3:00 close. Ramana speaks the ML part, Tushar the pitch and dashboard.

Use only claims the repo supports. Take every number from `docs/ML_RESULTS.md`, `docs/PLATFORM_RESULTS.md` or `docs/TECHNICAL_DESIGN.md`, and name the source next to it in the script's notes column.

### 3. Optional, only if tasks 1 and 2 are done and the VM is free

Run the API **in a container** with `infra/podman_api.sh` (the Containerfile you wrote has not been exercised with the payment model on the VM). If it builds and answers `/health` with `backend: model`, take a screenshot (`09_api_in_podman.png`) and add two lines to `docs/PLATFORM_RESULTS.md` under a new heading "Container" with what you saw (build time, first state time). If it fails, write what failed and do not claim containerized serving anywhere. Skip the systemd install unless Ramana asks.

## Claims we must not make

- **No accelerator speed-up for our model.** XGBoost, pandas and NetworkX run on CPU. The accelerator is present on the VM and used by the platform's own generative lab only.
- Rings are not "incremental". Scoring is a full recompute in micro-batches.
- The pig-butchering rings used to test the typology are synthetic, generated by our own team (`data/rings.py`), so say "simulated" when you mention them. Most laundering groups in IBM AML are still missed (see `docs/ML_RESULTS.md` caveats).
- Do not say a transaction is flagged "instantly". Say about 12 seconds on the idle VM.

## Send Ramana, when done

A short message: what is merged, what you could not do, and anything that did not match the docs.
