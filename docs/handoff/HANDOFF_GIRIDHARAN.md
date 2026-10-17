# Handoff for Giridharan's Claude: platform, API and integration (workstream C)

You are the AI assistant working with **Giridharan R E** on NEXUS Z, a graph-based fraud ring detector built for the IBM Z Datathon 2026. This file tells you what to do. Read it fully, then start at "Your tasks". Repo state described here: `main` at merge commit `0462796` plus the commit that added this file (2026-10-17).

## 1. Read these first, in this order

1. **The architecture flow (use it as your map):** https://claude.ai/artifact/SHz4vHQrEPCE8Q9mQ2fLdr
   If you have the Artifact tool, read it with `action: "read"`. If not, ask Giridharan to open it and paste the text; the essentials are in section 2.
   It was written before the ML code existed. Where it disagrees with the repo docs, **the repo docs win**. Differences are listed in section 2.
2. `README.md`, then `docs/TEAM_SPLIT.md` (who owns what).
3. `ml/README.md` (how the model plugs into your API) and `ml/artifacts/README.md` (the model folder and real example output).
4. `docs/ML_RESULTS.md` (what has been measured and what is weak; section 4 has the speed numbers on the target machine).
5. `api/README.md`, `api/schemas.py`, `api/backend.py`, `api/main.py` (your starting point).
6. `ml/api_backend.py` and `ml/service.py` (the adapter and the scoring functions you will call).

## 2. Architecture in one screen

```
OFFLINE: train and measure
  Data sources (A) -> Time split (A) -> Train models (B) -> Model bundle (B) -> Evaluation (A) -> Pitch numbers (D)
ONLINE: score as transactions arrive
  Transaction stream (C: you) -> Incremental graph (C: you) -> Refresh features (B) -> Score + rings (B) -> Explain + alert (B)
     -> Query API (C: you) -> Dashboard / victim warning (D)
The model bundle is the only thing that crosses from offline to online.
```

Owners: **A Verona:** `data/`, `eval/`, branch `verona-ann`. **B Ramana (team lead):** `ml/`, `ramana-sree`. **C Giridharan (you):** `api/`, `infra/`, `giridharan-re`. **D Tushar:** `dashboard/`, `pitch/`, `tushar-biswas`.

Where the artifact is out of date:
1. The ML core is built. The "model functions" contract is real: `ml/service.py` returns dicts shaped like `api/schemas.py`.
2. **"Refresh features, dirty nodes only" is not implemented.** `ModelBackend` does a **full rebuild** of features, scores and rings from the transactions it holds, at most once every `min_refresh_seconds`. Do not describe this as incremental or per-transaction real time. Say what it is: micro-batch rescoring.
3. Serving does not use scikit-learn or the SHAP package; they do not build on the s390x VM. Explanations use XGBoost's built-in TreeSHAP.
4. The artifact says Docker. **The VM has neither Docker nor Podman installed.** See Task 2.
5. The owner names on the artifact are current.

## 3. The project in five lines

- Pig-butchering scams: many victims pay a few collector accounts, money moves through mule chains in minutes, and leaves at a cash-out. The signal is in the network and the timing.
- The system scores accounts, groups high-risk accounts into rings, explains each flag, and warns likely victims.
- Scoring runs on an IBM LinuxONE (s390x) VM. Training happens elsewhere (laptop, Kaggle).
- The theme is "Real-Time AI for Critical Decisions", so the latency and throughput you measure matter to the pitch.
- **Everything reported must be measured by a run.** No projected numbers, and no accelerator claims (no on-chip AI is used).

## 4. Where things stand

Done and in `main`:
- `api/`: FastAPI app with `POST /transactions`, `GET /accounts/{id}`, `/rings`, `/rings/{id}`, `/alerts`, `/health`, behind a `Backend` protocol, served from invented sample data by `StubBackend`. Tests in `api/tests`.
- `ml/api_backend.py`: **`ModelBackend`**, a real implementation of your `Backend` protocol. Tested through your actual routes (`ml/tests/test_api_backend.py`).
- `ml/artifacts/HI-Small/`: the trained model folder (`model.json`, `meta.json`) and **real example output** in your schemas (`examples/`). You do not need to train anything.
- `ml/make_slice.py`: makes a small data slice (the last N hours) from the big file.
- Tests: `python -m pytest ml/tests api/tests -q` gives 38 passed on a laptop. On the VM, expect about 34 passed and 4 skipped (the skips need scikit-learn or SHAP, which the VM does not have).

Measured on the VM (RHEL 9.8, **s390x big-endian**, 3 vCPUs, 7.5 GB RAM) with the last 48 hours of data (862,792 transactions), three runs: features 1.8 to 1.9 s, score plus rings 0.6 s, **full rescore 2.4 to 2.5 s**, score one account with explanation 8.4 to 8.6 ms, describe and explain all rings once 7.9 s (then cached), peak memory 742 MB. Predictions on the VM match the laptop's to within 9e-16. Rebuilding from all 5M transactions of HI-Small took about 25 s on a laptop and may not fit in the VM's memory, so **serve a time slice, not the full file**.

Not done (yours): the real backend switch, non-blocking refresh, containers or a service, the streaming simulator, API latency measurements, the demo scenario.

## 5. Your tasks, in order

### Task 1: get onto the VM and make it reproducible

The VM belongs to Ramana's datathon account. **Its address and key are not in this repo** (the repo is public): ask Ramana to either append Giridharan's SSH public key to `~/.ssh/authorized_keys` of user `linux1`, or send the key file privately. Never commit a key, an IP address or a password. `sudo` is passwordless for `linux1`.

What already exists there (built by Ramana):
- Python 3.12 virtualenv `~/nexusz-venv` created with `--system-site-packages`. numpy 1.24.4 and scipy 1.11.1 come from RHEL packages (`python3.12-numpy`, `python3.12-scipy`) pinned in `~/constraints.txt`. pandas 2.2.3 and xgboost 3.4.1 were **compiled from source**. fastapi, uvicorn, pydantic, httpx, pytest, networkx are installed.
- The repo at `~/Nexus-Z` (on an old branch; run `git checkout main && git pull`), the model at `~/bundle`, a 48-hour slice at `~/data/ibm-aml/HI-Slice_Trans.csv`, install scripts `~/setup_env2.sh` and `~/setup_pandas.sh`.

What you must know about s390x (learned the hard way):
- PyPI has **no s390x wheels** for numpy, pandas, scipy, scikit-learn or pyarrow, so pip tries to compile them. numpy and scipy are taken from `dnf`. pandas needed `pip install --no-deps --no-build-isolation "pandas==2.2.3"` with Cython 3.0.x, meson-python, versioneer installed first (the isolated build picked a Cython that was too old).
- **scikit-learn, SHAP and numba do not build.** Do not add them. `XGBClassifier` needs scikit-learn, so serving uses the native `xgboost.Booster`; keep it that way.

Write `infra/setup_vm.sh` that reproduces this environment from scratch (dnf packages, venv, pinned versions, the pandas flags above) and **test it** on the VM. Document it in `infra/README.md`.

Acceptance: on the VM, `python -m pytest ml/tests api/tests -q` passes (4 skips are expected), and `python -m ml.latency_check check ~/bundle ~/reference.csv` reports the predictions identical to the laptop's (`~/reference.csv` is already on the VM).

### Task 2: how to run the API on the VM (containers or not, honestly)

The plan says Docker containers on LinuxONE. Neither Docker nor Podman is installed. Podman is available with `sudo dnf install podman`. Choose one and say which:
- **Containers:** a Containerfile for the API on a UBI 9 base image (UBI is published for s390x). You would have to build pandas and xgboost inside the image, which is slow, or mount the host virtualenv. Test that the container starts the API and answers `/health`.
- **No containers:** run `uvicorn` as a `systemd` service. Fine if time is short, but then **do not claim Docker or containers anywhere** (README, deck, API docs).

Acceptance: one documented command starts the API on the VM and `/health` answers.

### Task 3: switch the API to the real model

In `api/backend.py`, make `get_backend()` choose by environment variable. Keep the stub as the default so `api/tests` still pass without data:

```python
import os
from functools import lru_cache
from pathlib import Path

@lru_cache
def get_backend():
    if os.environ.get("NEXUSZ_BACKEND") == "model":
        from data.ibm_aml import load_transactions
        from ml.api_backend import ModelBackend
        tx = load_transactions(os.environ.get("NEXUSZ_SLICE", "HI-Slice"))   # <NEXUSZ_DATA_DIR>/ibm-aml/HI-Slice_Trans.csv
        return ModelBackend.from_dir(Path(os.environ.get("NEXUSZ_BUNDLE", "ml/artifacts/HI-Small")), tx)
    from .stub_backend import StubBackend
    return StubBackend()
```

Facts you need about `ModelBackend` (read `ml/api_backend.py`):
- The history table needs columns `ts, src, dst, amount, currency, receiving_currency, channel`. `data.ibm_aml.load_transactions` produces them. Make the 48-hour slice with `python -m ml.make_slice HI-Small 48 HI-Slice` (needs the 450 MB HI-Small file) or copy the existing slice from the VM.
- Account ids come from the order of the file, so **ids from a slice differ from the ids in `ml/artifacts/.../examples/`**, which came from the full file. Do not expect the example ring ids to appear.
- `ingest` queues rows; the next read after `min_refresh_seconds` triggers a rebuild. Ingested rows are assumed to be in US dollars (the API has no currency field).
- Needs only numpy, scipy, pandas, networkx, xgboost, pydantic.

Acceptance: with `NEXUSZ_BACKEND=model` the API serves real rings from the slice; `/health` returns `"backend": "model"`; the stub still works by default; `api/tests` pass.

### Task 4: make refresh non-blocking (important for latency)

Today the rebuild runs **inside the request** that triggers it, so one unlucky request waits about 2.5 s (48-hour slice) or more. Fix it in `api/` (subclass or wrap `ModelBackend`; if you need to change `ml/api_backend.py`, tell Ramana first):
- Rebuild in a background thread. Keep serving the last good state until the new one is ready, then swap it in atomically.
- Protect the pending-transaction queue with a lock.
- Expose `refresh_seconds` and the age of the served state (for example in `/health`) so the dashboard can show "as of".

Acceptance: a test where reads stay fast while a (simulated slow) rebuild is running.

### Task 5: streaming simulator and demo scenario

Write `infra/simulator.py`: replay transactions from the slice through `POST /transactions` in batches at a configurable speed. Scenario: start the backend with the first 24 hours as history, replay the rest, so rings form and alerts appear while the dashboard is open. Keep a fixed seed and a scripted order so the demo is repeatable. Save the command in `infra/README.md`.

### Task 6: measure, then write down only what you measured

Run the simulator against the API on the VM and record, with date and machine:
- per-endpoint latency p50 and p95 under load,
- ingest throughput that the API sustains,
- time from a transaction being accepted to it affecting `/rings` (bounded by `min_refresh_seconds` plus the rebuild time),
- memory and CPU.

Write them to `docs/PLATFORM_RESULTS.md`, next to the numbers already in `docs/ML_RESULTS.md` section 4. Report the weak ones too.

### Task 7: serve the dashboard (Tushar) a stable, honest API

- Keep `api/schemas.py` stable. If you must change a shape, tell Tushar and Ramana first.
- Replace `api/examples/*.json` (invented) with real output, or point Tushar at `ml/artifacts/HI-Small/examples/` (real, validated).
- Tell Tushar these facts, which the UI must respect: ring `risk` is the learned chance a ring is mostly laundering accounts, it favors small rings, so the top of the list holds 3-account rings; **roles are guessed** from position (the data has no role labels), so do not present them as validated; **`total_amount` and edge amounts mix currencies and must not be shown as dollars**; **ring ids are a hash of the member list, so a ring that gains a member gets a new id** (selection can jump between refreshes; raise it with Ramana if this hurts).
- CORS currently allows ports 3000 and 5173. Add what Tushar needs.

### Task 8: the victim warning path

`GET /alerts` already carries `victim_warning` entries (accounts that recently paid into a flagged ring, from `Scorer.likely_victims`). The customer-app "Check before you send" mock-up needs a payment pre-check. Propose an endpoint to Tushar and Ramana (for example `GET /accounts/{destination}` is enough today). The victim rule is simple ("recent payer into the ring in the last 48 hours") and **has not been evaluated**, so do not present it as accurate.

### Task 9: end to end on the VM

Run the whole chain on the VM: API with `NEXUSZ_BACKEND=model`, simulator, dashboard (if Tushar's is ready) or `curl`. Write the script for the demo and the commands to reset it.

## 6. Rules

- Work on branch `giridharan-re`. Open pull requests into `main`; Ramana (team lead) merges. Commit small and often.
- Edit only `api/` and `infra/` (and `docs/PLATFORM_RESULTS.md`). Do not change `ml/`, `data/`, `dashboard/` or `pitch/` without telling the owner.
- The repository is **public**. Never commit keys, tokens, IP addresses, passwords or data files.
- No real personal data. Account ids are pseudonymized.
- Report only measured results, with the machine and date. Do not claim containers, incremental updates or accelerator use unless they exist.
- Use your own commit conventions and tooling rules; do not copy any other person's settings.

## 7. Questions to send to Ramana (through Giridharan)

1. VM access (public key or key file).
2. Datathon judging criteria and deadline, so latency work is weighted correctly.
3. Is a ring-id that survives growth needed for the dashboard?

## 8. Report back

When you finish a task, tell Giridharan: what you built, the command that runs it, the numbers it produced (machine and date), what surprised you, and what you did not test.
