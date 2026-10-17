# Platform results (API, refresh, simulator)

Workstream C. These are **new measurements of the API**, taken with `infra/bench.py`. They are separate from the
model measurements in `docs/ML_RESULTS.md` (accuracy, and the 2.4 to 2.5 s full rescore on the VM). Nothing here is
copied from there.

**Status: local laptop measurements only. LinuxONE measurements are PENDING** (no SSH access to the VM when this was
written; the key and address come from Ramana). Do not quote the laptop numbers as LinuxONE performance. The VM has 3 vCPUs
and 7.5 GB; the laptop below has 12 logical CPUs and 15 GB, so the VM should be expected to be slower, but that is a
prediction, not a measurement.

| Platform | Status |
|---|---|
| Local laptop (Windows), real model, 24 h history + replay | **measured** (2 runs, below) |
| LinuxONE VM (s390x), same workload | **pending** (command at the end) |

## 1. What was measured, and how

**Machine (local):** Windows 11 (10.0.26200), AMD Ryzen 5 7535HS, 6 cores / 12 logical, 15.2 GB RAM, Python 3.14.6,
pandas 3.0.5, numpy 2.5.1, xgboost 3.4.1. Client and server on the same machine over loopback, so the numbers have
no network time in them. API run with `uvicorn` as a normal process (no container, no systemd).

**Backend:** `NEXUSZ_BACKEND=model`, real bundle `ml/artifacts/HI-Small`, `NEXUSZ_HISTORY_HOURS=24`,
`NEXUSZ_ACTIVE_HOURS=24`, `NEXUSZ_MIN_REFRESH_SECONDS=5`.

**Data:** `HI-Slice`, the last 48 hours of the HI-Small primary period made with `python -m ml.make_slice HI-Small 48 HI-Slice`
(862,792 transactions). The API started with the first 24 hours as history: **654,467 transactions**. The other 208,325
rows were written by `infra.simulator prepare` and are the replay source. IBM AML synthetic data, pseudonymized ids. The data
mixes currencies; the API treats ingested amounts as dollars.

**Dates:** run 1 at 2026-10-17 11:28 UTC, run 2 at 11:38 UTC.

**Method** (`python -m infra.bench`, four phases, one process each run):
1. *Idle latency:* 100 rounds of sequential `GET /health`, `/rings`, `/rings/{id}` (top ring), `/accounts/{id}` (first
   member of the top ring), `/alerts?limit=50`, plus 20 `POST /transactions` of 500 replay rows. No refresh running.
2. *Ingest throughput:* 50,000 replay rows in batches of 500, back to back from one client.
3. *Under load:* 60 s with 4 reader threads running the read mix in a tight loop (no think time) while one thread posts a 500-row
   batch about twice a second (about 900 rows/s in the run), so background refreshes run continuously. A sampler polls `/health` every 0.25 s.
4. *Freshness:* 3 probes. For each, wait until the server is idle (no refresh, nothing pending), `POST` one transaction
   (new destination account), then poll `GET /accounts/<destination>` every 50 ms until it stops returning 404. The time is measured from
   the POST response to the first 200.

Latency is wall-clock as seen by the client (HTTP and JSON included), nearest-rank percentiles. CPU and memory are for the
server process (`psutil`). `n` is the number of requests behind each figure.

## 2. Results, local laptop

### Idle latency (milliseconds, no refresh running)

| Endpoint | n | p50 | p95 | max | errors |
|---|---|---|---|---|---|
| `GET /health` | 100 | 3.3 | 3.9 | 4.4 | 0 |
| `GET /rings` | 100 | 4.0 | 4.8 | 5.1 | 0 |
| `GET /rings/{id}` | 100 | 3.6 | 4.2 | 6.5 | 0 |
| `GET /accounts/{id}` (ring member) | 100 | 3.4 | 4.1 | 106.0 | 0 |
| `GET /alerts?limit=50` | 100 | 3.6 | 4.5 | 5.1 | 0 |
| `POST /transactions` (500 rows) | 20 | 12.6 | 189.1 | 198.4 | 0 |

Two things to read carefully. The 106 ms maximum on `/accounts/{id}` is the first lookup of a ring member in a new
snapshot (role inference scans all history; later lookups come from a per-snapshot memo). The `POST` p95 of 189 ms is
the slowest of 20 requests; the median is 12.6 ms, and a few posts are slow, most likely when a refresh is starting and competing for the CPU (not investigated).

### Ingest throughput

50,000 rows submitted, 50,000 accepted, 0 rejected, batch size 500, 2.89 s: **about 17,300 rows/s accepted into the queue.**
That is the speed at which the API takes rows, not the speed at which they are scored. Scoring happens in the next rebuild
(see freshness).

### Under load (60.6 s, 4 reader threads + ingest of about 900 rows/s)

| Endpoint | n | p50 ms | p95 ms | max ms | errors |
|---|---|---|---|---|---|
| `GET /health` | 2957 | 12.4 | 28.0 | 738 | 0 |
| `GET /rings` | 2957 | 13.3 | 28.8 | 632 | 0 |
| `GET /rings/{id}` | 2957 | 12.5 | 28.0 | 744 | 0 |
| `GET /accounts/{id}` | 2957 | 12.4 | 28.8 | 666 | 0 |
| `GET /alerts?limit=50` | 2957 | 12.7 | 29.5 | 402 | 0 |
| `POST /transactions` (500 rows) | 106 | 34.2 | 207.7 | 615 | 0 |

53,000 rows ingested (0 rejected). A refresh was running in **100% of the health samples**; 3 refreshes finished during the
60 s. The oldest served state seen was **27.0 s** old. Server CPU averaged **420% of one core** (xgboost and pandas
use several threads) on a 12-thread machine, so the same load on 3 vCPUs will be CPU-bound; that is exactly the pending
VM measurement. Reads stay at tens of milliseconds while rebuilds run, but note the reason they are slower than idle
(about 12 ms against about 3.5 ms): the likely cause is 4 clients in a tight loop plus a rebuild competing for the CPU and Python's GIL; requests do not
wait for the rebuild (reads never take its lock). The cause was not isolated by a separate experiment, and neither was the occasional maximum of 400 to 740 ms.

### Freshness (accepted -> visible in served results)

| Probe | Seconds until `GET /accounts/<dst>` returned 200 |
|---|---|
| 1 | 15.22 |
| 2 | 15.32 |
| 3 | 14.85 |

`last_rebuild_seconds` at the time was 14.79 and `refresh_interval_seconds` 5.0. The probes started from an idle server,
more than 5 s after the previous rebuild began, so the wait was the rebuild itself (about 15 s) and the 5 s interval added nothing.
**Weak result:** a transaction takes about 15 s to affect `/rings` on this laptop with 654k rows of history. Under sustained
ingest the wait is longer, because a rebuild in progress cannot include rows that arrive after it started: they wait for the next one
(so up to about 2 x the rebuild time; the oldest served state seen under load was 27 s). The rebuild time is not decomposed; it includes
feature building, scoring, ring detection, **describing every ring**, and precomputing the alerts. The 2.4 to 2.5 s in
`docs/ML_RESULTS.md` is features plus scoring plus ring detection only, on a different machine and history size, so the two
numbers should not be compared.

### Resources (server process)

RSS after startup 556 MB (peak 871 MB while building the first state); after the run 662 MB with a peak of **1,241 MB** (history had
grown by 113,000 replay rows plus 3 probes, and a rebuild holds the old and the new state at once). CPU time
used in the run: about 510 s. On the 7.5 GB VM this leaves room, but the VM figure is pending.

### Run 1 (before the per-snapshot alert and account cache): why it matters

The first run, on the same machine and data, exposed that `Scorer.list_alerts` (ML code) rescans all history for each of the top
10 rings, and `score_account` does the same for ring members. Idle, `/alerts` p50 was **608.5 ms** (p95 657) and ring-member
`/accounts/{id}` p50 **95.9 ms**; under load `/alerts` p50 was 975 ms (p95 1,663, max 2,182) and the oldest served state was 98 s. The API
now computes the alert list once per snapshot in the background thread and memoizes ring-member accounts, without changing `ml/`. Run 2
is the current code. Run 1 is kept so the effect is visible: `/alerts` idle p50 608.5 -> 3.6 ms, ring-member account 95.9 -> 3.4 ms, `last_rebuild_seconds`
14.6 -> 14.8 s (the alert precompute now happens inside the rebuild). Idle freshness was 11.8 to 14.7 s in run 1 and 14.9 to 15.3 s in run 2; that
difference is larger than the work added, so treat it as run-to-run variation (3 probes each), not as a regression I can explain.

## 3. Checks that the served results change (local, real model)

On the same server after the replay (`GET /health` -> `refreshes_completed` 8, `history_transactions` 767,470, `data_as_of`
2022-09-10T12:03): 50 rings; the top ring is `RNG-B60786` (risk 87, 5 accounts). At the start (24 h history only) the top three alerts were
`RNG-B60786`, `RNG-AF9501` and `RNG-8BD5D5`; after the replay the top 5 are `RNG-B60786`, `RNG-896B5C`, `RNG-A0B92F`, `RNG-BCF3D6`, `RNG-8AFDFA`, so `RNG-AF9501` and `RNG-8BD5D5` are no longer in the top 5
(ring ids change with membership, or they were outranked; I did not check which). The ring list did change as transactions were replayed. `/alerts` held 10 ring alerts and 24
`victim_warning` alerts. A `victim_warning` account looked up with `GET /accounts/{id}` had risk 0.0021 and no ring, which is a reminder
that the warning rule ("paid into a flagged ring recently") is independent of the payer's own score and has not been evaluated. Unknown
account and ring ids return 404.

## 4. Tests

| Suite | Command | Result (local, Python 3.14) |
|---|---|---|
| Baseline before this work | `python -m pytest ml/tests api/tests -q` | 37 passed, 1 skipped |
| `ml/tests` | | 29 passed, 1 skipped (SHAP comparison; SHAP not installed) |
| `api/tests` | | 39 passed (8 existing + 31 new: backend selection, bad configuration, refresh, atomic swap, payment pre-check) |
| `infra/tests` | | 37 passed (simulator parsing, batching, determinism, timeouts, HTTP failures; bench helpers) |
| All | `python -m pytest ml/tests api/tests infra/tests -q` | **105 passed, 1 skipped, 0 failed** |
| LinuxONE | same command | **pending** (expect a few more skips there: scikit-learn / SHAP) |

Local integration (real bundle and real slice, API process, simulator, bench): done, the results above. The model-mode API test
`test_model_mode_serves_the_real_bundle_over_the_slice` runs the real `ml/artifacts/HI-Small` bundle over a small synthetic slice
written in the raw IBM format. The refresh tests use a tiny model trained on a planted ring and a deliberately slow builder.

## 5. Not measured / limits

- **Nothing on LinuxONE yet:** setup script, parity check, Podman or systemd deployment, VM latency, VM memory. Run it there
  (below) and fill the table.
- One run per configuration; the idle freshness probes are 3 samples, so there is no confidence interval. Treat 15 s as "about 15 s on this machine".
- Client and server shared the machine, so the client competed for CPU in the load phase.
- No test of many concurrent ingest clients, only one ingest thread. Batch size 500 only.
- The wait for a transaction to show up was measured only for a new destination account (`GET /accounts/<dst>` becomes 200), not as a
  change in `/rings` content, which depends on the model's choices.
- Long runs grow the history (ingested rows are kept) and with it the rebuild time; not measured beyond +113k rows.
- Mixed currencies: amounts are not dollars; the bench does not check amounts.

## 6. Reproduce, and the pending VM run

```bash
# start the API (see infra/README.md), then:
python -m infra.simulator prepare --slice HI-Slice --history-hours 24 --out ~/nexusz-replay.csv
python -m infra.bench --url http://127.0.0.1:8000 --replay ~/nexusz-replay.csv --pid <server pid> --out ~/bench.json
```
On the VM `bench.py` reads CPU and memory from `/proc/<pid>` and also records OS, architecture, Python and RAM. Restart the API before each run
(the bench adds replay rows and probe transactions). Replace the "pending" rows above with the VM numbers and keep the laptop table as the local reference.
