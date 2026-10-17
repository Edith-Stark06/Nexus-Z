# Platform results (API, refresh, simulator)

Workstream C. These are **new measurements of the API**, taken with `infra/bench.py`. They are separate from the
model measurements in `docs/ML_RESULTS.md` (accuracy, and the 2.4 to 2.5 s full rescore on the VM). Nothing here is
copied from there.

**Status: the clean LinuxONE benchmark with the current (payment-level) model is done: section 3b.** Sections 1, 2 and 3 are older: the laptop benchmark and the contended VM check were taken with the earlier account-level model, so do not quote their freshness or rebuild figures for the current model. Do not quote the laptop numbers as LinuxONE performance either.

**Update after the merge (checked by Ramana on 2026-10-17, one run).** Every measurement below was taken with the earlier account-level model that was in `ml/artifacts/HI-Small` at the time. The committed model is now the payment-level one (see `docs/ML_RESULTS.md`), which is heavier to rebuild. On the laptop, with the merged code, the real slice and the same 24-hour history (654,467 rows): the API started in 42 s, the first state took **32.9 s** to build and the rebuild after a 20,000-row replay took **32.7 s**, against about 15 s below. So a transaction becomes visible after about 33 s on that laptop, not about 15 s, and longer under sustained ingest. Single requests answered in 3 to 5 ms (70 ms for the first lookup of a ring member); this was not a benchmark. Part of that time was avoidable: describing all 174 rings took 16.6 s of it, because each ring rescanned the whole history and made its own SHAP call. PR #17 filters the history once and explains all members in one call (same output, checked on all 174 rings): that step now takes 1.8 s. The rebuild was not re-timed end to end on the laptop after the change. The idle-VM benchmark with the payment model is section 3b.

| Platform | Status |
|---|---|
| Local laptop (Windows), real model, 24 h history + replay | **measured** (2 runs, below) |
| LinuxONE VM (s390x): environment check, tests, parity, API start, 20k-row replay | **done once, while a training job was running** (section 3) |
| LinuxONE VM (s390x): `infra/bench.py` with the payment-level model (latency p50/p95, throughput, freshness, load) | **measured once on an idle VM** (section 3b) |

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

## 3. LinuxONE VM: what was run (contended, not a benchmark)

VM: RHEL 9.8, s390x (big-endian), 3 vCPUs, 7.5 GB RAM, Python 3.12.15, numpy 1.24.4, scipy 1.11.1, pandas 2.2.3, xgboost 3.4.1.
Date 2026-10-17 around 11:55 to 12:00 UTC. Code: branch `giridharan-re` at `e73442e`, in a separate clone (Ramana's checkout was not touched).
**Another user's job was running the whole time**: `ml.stack_eval HI-Small` (about 265% CPU, 3 GB) during the setup check, and `ml.edge_eval HI-Small`
(about 175 to 200% CPU, 4.4 GB) during the API run. My processes ran at `nice 19` inside a 2 GB memory cap. Treat the timings below as pessimistic and not repeatable; they are
not a clean benchmark.

| Check | Result |
|---|---|
| `bash infra/setup_vm.sh --check --tests` | environment matches the documented one (all pinned versions present, native `xgboost.Booster` round trip OK, byteorder big) |
| `python -m pytest ml/tests api/tests infra/tests -q` | **102 passed, 4 skipped, 0 failed** (3.9 s; the 4 skips are the scikit-learn and SHAP tests the handoff predicted) |
| `python -m ml.latency_check check ~/bundle ~/reference.csv` | **IDENTICAL within 1e-5**: max margin difference 8.88e-16 over 300 rows |
| API via `infra/run_api.sh` (foreground, no container, no systemd), model backend, `HI-Slice`, 24 h history = 654,467 rows | `/health` answered 21 s after launch; `backend: model`; first state built in 14.09 s |
| Endpoints on that state | 59 rings, ring detail with edges and reasons, account lookup, 35 alerts (ring and victim_warning) |
| `infra.simulator replay --max 20000` | 20,000 submitted, 20,000 accepted, 0 rejected, 0 failed, 1.4 s |
| After the replay | `refreshes_completed` 2, `last_rebuild_seconds` 15.0, `data_as_of` moved to 2022-09-10T00:40, rows were in the served state 32 s after the replay finished (checked every 2 s) |
| Server memory | RSS 570 MB after start (peak 943 MB); 652 MB after the replay (peak 1,473 MB) |
| Shutdown | server stopped cleanly; port 8000 closed; nothing left running |

Not done on the VM: `infra/bench.py` (p50/p95 per endpoint, throughput, load, freshness probes), systemd service install (not approved in the session), Podman build.
So there is no clean per-endpoint latency for LinuxONE yet. The rebuild time of about 14 to 15 s on 3 vCPUs is similar to the laptop's, but it was measured with another job using most of the CPU, so
it says little about an idle VM.

## 3b. LinuxONE VM: benchmark with the payment-level model, idle VM

Run by Ramana on 2026-10-17 at 15:38 UTC, one run. VM as in section 3 (3 vCPUs, 7.5 GB, Python 3.12.15, pandas 2.2.3, xgboost 3.4.1); load average 0.00 before the start and nothing else running. Code: `main` at `fd5f2e6` (includes the ring-description speed-up of PR #17). `NEXUSZ_BACKEND=model`, the committed bundle `ml/artifacts/HI-Small` (payment-level), `HI-Slice`, 24 h of history = 654,467 rows, replay file of 208,325 rows from `infra.simulator prepare`. The API ran with `infra/run_api.sh` (no container, no systemd); the benchmark client ran on the same VM over loopback, so it competed with the server for the 3 vCPUs. Same four phases as in section 1.

**Rebuild and freshness**

| Measure | Result |
|---|---|
| First state after start (654k rows) | 15.3 s |
| `last_rebuild_seconds` at the end of the run (769k rows) | 12.5 s |
| Freshness, 3 idle probes (accepted until visible) | 12.27, 12.59, 12.61 s |

Compared with the laptop figures for the same model before PR #17 (32.9 s first state), the VM is faster. That is a comparison of two different setups (Python 3.14 and pandas 3 on the laptop), not a statement about the speed-up from PR #17 alone, which is only measured as the 16.6 s to 1.8 s ring-description step.

**Idle latency** (milliseconds, 100 sequential requests each, no refresh running)

| Endpoint | p50 | p95 | max |
|---|---|---|---|
| `GET /health` | 1.9 | 18.3 | 36.1 |
| `GET /rings` | 2.9 | 22.7 | 68.6 |
| `GET /rings/{id}` | 2.4 | 31.5 | 88.6 |
| `GET /accounts/{id}` | 2.2 | 22.4 | 35.0 |
| `GET /alerts?limit=50` | 2.6 | 26.6 | 160.8 |
| `POST /transactions` (500 rows, n=20) | 8.6 | 45.6 | 56.0 |

The medians are a few milliseconds. The p95 values (18 to 32 ms) are much higher than on the laptop (4 to 5 ms); the cause was not investigated.

**Ingest:** 50,000 rows submitted, 50,000 accepted, 0 rejected, in 1.36 s: about 36,900 rows/s into the queue (not scored yet).

**Under load** (60 s, 4 reader threads in a tight loop, about 900 rows/s ingested, 54,500 rows accepted, 0 rejected): a refresh was running in 100% of the samples and 2 refreshes finished; the oldest served state seen was **36.2 s** old. Read latency while rebuilding:

| Endpoint | n | p50 ms | p95 ms | max ms | errors |
|---|---|---|---|---|---|
| `GET /health` | 4159 | 3.2 | 41.0 | 538 | 0 |
| `GET /rings` | 4159 | 4.2 | 45.8 | 341 | 0 |
| `GET /rings/{id}` | 4159 | 3.4 | 37.6 | 456 | 761 |
| `GET /accounts/{id}` | 4159 | 4.1 | 57.6 | 462 | 0 |
| `GET /alerts?limit=50` | 4159 | 3.3 | 39.6 | 578 | 0 |
| `POST /transactions` (500 rows) | 109 | 20.8 | 107.0 | 260 | 0 |

The 761 errors on `GET /rings/{id}` are all HTTP 404 (counted in the server log; there were no 5xx responses). The benchmark asks for one fixed ring id, and a ring id is a hash of its members, so when a rebuild regrew or split that ring its id no longer existed. This is the likely cause; I did not log which ids disappeared. For the dashboard it means a ring opened from a list that is a few seconds old can return 404 after a refresh, and the page should reload the list when that happens.

Under load the server used about 113% of one core on average. **Resources:** RSS 956 MB after the first state (peak 2,382 MB while building it); 1,685 MB at the end with a peak of 3,255 MB (the old and the new state are held at once while a rebuild finishes), out of 7.5 GB.

Limits: one run, three freshness probes, client and server on the same 3 vCPUs. Under sustained ingest a transaction waits for the rebuild in progress and then for the next one, so about 12 s idle is the best case and the oldest state seen under load was 36 s.

## 4. Checks that the served results change (local, real model)

On the same server after the replay (`GET /health` -> `refreshes_completed` 8, `history_transactions` 767,470, `data_as_of`
2022-09-10T12:03): 50 rings; the top ring is `RNG-B60786` (risk 87, 5 accounts). At the start (24 h history only) the top three alerts were
`RNG-B60786`, `RNG-AF9501` and `RNG-8BD5D5`; after the replay the top 5 are `RNG-B60786`, `RNG-896B5C`, `RNG-A0B92F`, `RNG-BCF3D6`, `RNG-8AFDFA`, so `RNG-AF9501` and `RNG-8BD5D5` are no longer in the top 5
(ring ids change with membership, or they were outranked; I did not check which). The ring list did change as transactions were replayed. `/alerts` held 10 ring alerts and 24
`victim_warning` alerts. A `victim_warning` account looked up with `GET /accounts/{id}` had risk 0.0021 and no ring, which is a reminder
that the warning rule ("paid into a flagged ring recently") is independent of the payer's own score and has not been evaluated. Unknown
account and ring ids return 404.

## 5. Tests

| Suite | Command | Result (local, Python 3.14) |
|---|---|---|
| Baseline before this work | `python -m pytest ml/tests api/tests -q` | 37 passed, 1 skipped |
| `ml/tests` | | 29 passed, 1 skipped (SHAP comparison; SHAP not installed) |
| `api/tests` | | 39 passed (8 existing + 31 new: backend selection, bad configuration, refresh, atomic swap, payment pre-check) |
| `infra/tests` | | 37 passed (simulator parsing, batching, determinism, timeouts, HTTP failures; bench helpers) |
| All | `python -m pytest ml/tests api/tests infra/tests -q` | **105 passed, 1 skipped, 0 failed** |
| LinuxONE (s390x, Python 3.12) | same command, via `setup_vm.sh --check --tests` | **102 passed, 4 skipped, 0 failed** (4 skips: scikit-learn / SHAP). Ran before the final doc-only commit; code unchanged |

Local integration (real bundle and real slice, API process, simulator, bench): done, the results above. The model-mode API test
`test_model_mode_serves_the_real_bundle_over_the_slice` runs the real `ml/artifacts/HI-Small` bundle over a small synthetic slice
written in the raw IBM format. The refresh tests use a tiny model trained on a planted ring and a deliberately slow builder.

## 6. Not measured / limits

- **LinuxONE:** `bench.py` was run once on an idle VM (section 3b). The systemd unit and the Podman image were not part of that run.
- One run per configuration; the idle freshness probes are 3 samples, so there is no confidence interval. Treat 15 s as "about 15 s on this machine".
- Client and server shared the machine, so the client competed for CPU in the load phase.
- No test of many concurrent ingest clients, only one ingest thread. Batch size 500 only.
- The wait for a transaction to show up was measured only for a new destination account (`GET /accounts/<dst>` becomes 200), not as a
  change in `/rings` content, which depends on the model's choices.
- Long runs grow the history (ingested rows are kept) and with it the rebuild time; not measured beyond +113k rows.
- Mixed currencies: amounts are not dollars; the bench does not check amounts.

## 7. Reproduce, and the pending VM run

```bash
# start the API (see infra/README.md), then:
python -m infra.simulator prepare --slice HI-Slice --history-hours 24 --out ~/nexusz-replay.csv
python -m infra.bench --url http://127.0.0.1:8000 --replay ~/nexusz-replay.csv --pid <server pid> --out ~/bench.json
```
On the VM `bench.py` reads CPU and memory from `/proc/<pid>` and also records OS, architecture, Python and RAM. Restart the API before each run
(the bench adds replay rows and probe transactions). The laptop table is the local reference; section 3b has the VM numbers.
