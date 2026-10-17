# NEXUS Z API

FastAPI service for the dashboard. It runs in one of two modes, chosen by `NEXUSZ_BACKEND`:

- **`stub` (default):** serves **invented** sample rings from `sample_data.py`. Every ID, amount and ring is made up. Needs no model or data files, so the dashboard and the tests work anywhere.
- **`model`:** serves the trained model over a transaction slice (real output). Needs the model folder and the slice. See `infra/README.md` for setup on LinuxONE.

`GET /health` tells you which one you are talking to (`"backend": "stub"` or `"model"`). Do not present stub output as live results.

## Run

From the repo root:

```
pip install -r api/requirements.txt
uvicorn api.main:app --reload --port 8000            # stub

# real model (also needs pandas, numpy, scipy, networkx, xgboost; see ml/README.md)
NEXUSZ_BACKEND=model NEXUSZ_DATA_DIR=<folder containing ibm-aml/> NEXUSZ_BUNDLE=ml/artifacts/HI-Small \
  uvicorn api.main:app --port 8000
```

Interactive docs: http://localhost:8000/docs. CORS allows the dashboard dev servers on ports 3000 and 5173 (localhost and 127.0.0.1); add more with `NEXUSZ_CORS_ORIGINS=http://host:port,...`.

Configuration variables (`NEXUSZ_SLICE`, `NEXUSZ_HISTORY_HOURS`, `NEXUSZ_MIN_REFRESH_SECONDS`, ...) are listed in `backend.py` and `infra/README.md`. A wrong value stops the server at startup with a message; it never falls back to the stub.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /health` | `{"status": "ok", "backend": "stub"}`. In model mode also `refresh_interval_seconds`, `state_age_seconds`, `last_rebuild_seconds`, `data_as_of`, `history_transactions`, `pending_transactions`, `refreshing`, `refreshes_completed`, `last_error`. `status` is `"degraded"` when the latest refresh failed (the previous results are still served) |
| `POST /transactions` | Accepts one transaction or a list of at most 5000 (413 above that). Fields: `tx_id, ts, src, dst, amount, channel`. Returns `{"accepted": n, "backend": ...}` |
| `GET /rings` | Ring summaries, highest risk first |
| `GET /rings/{ring_id}` | Members with roles, time-ordered edges (for the replay slider), top reasons |
| `GET /accounts/{account_id}` | Account risk, role, ring, reasons, neighborhood. Also the payment pre-check, see below |
| `GET /alerts?limit=50` | Ring alerts and victim warnings, newest first |

Stub IDs to try: `RNG-0417`, `RNG-0392`, `RNG-0455`, and `ACC-7F3A` (a collector in `RNG-0417`, the account in the warning screen). In model mode use IDs from `GET /rings`; they depend on the slice.

## For the dashboard (Tushar): what the data does and does not mean

- Base URL `http://127.0.0.1:8000` (SSH-tunnel to the VM for the live demo). Shapes are in `schemas.py` and have not changed.
- **Freshness.** In model mode a posted transaction shows up in `/rings` only after the next background rebuild (`refresh_interval_seconds` plus `last_rebuild_seconds`; measured values in `docs/PLATFORM_RESULTS.md`). Show "as of `data_as_of`" and `state_age_seconds` from `/health`. It is micro-batch rescoring, not instant per-transaction scoring.
- **Ring `risk`** is the learned chance that a ring is mostly laundering accounts. It favors small rings, so the top of the list holds 3-account rings. It is an indicator for investigation, **not proof** of anything.
- **Roles are guessed** from each account's position in the ring's internal payments. The data has no role labels; do not present them as validated.
- **`total_amount` and edge `amount` mix currencies.** Do not show them with a `$` sign. Ingested transactions are assumed to be US dollars because the API has no currency field.
- **Ring ids are a hash of the member list**, so a ring that gains a member gets a new id. A selected ring can disappear between refreshes: handle a 404 on `/rings/{id}` by returning to the list.
- **Payment pre-check ("Check before you send").** `GET /accounts/{destination}`: `ring_id` set means the destination is in a flagged ring (show "potential risk, review recommended" and the `reasons`); `ring_id: null` means it is not in a flagged ring right now, which is **not** a guarantee of safety; **404 means no information**, not "safe". `victim_warning` alerts come from a simple rule (paid into a flagged ring in the last 48 hours) that has **not been evaluated**.
- Real example output (validated against these schemas) is in `ml/artifacts/HI-Small/examples/`. The files in `api/examples/` are the **stub's invented data**.

## No server? Use the example files

`api/examples/*.json` hold the stub's responses (invented). Regenerate them with `python -m api.export_examples`. Real model output: `ml/artifacts/HI-Small/examples/`.

## Contract notes

- Response shapes live in `schemas.py`. Change them only by agreement, since the dashboard depends on them.
- `risk` is 0 to 100 on rings and 0 to 1 on accounts.
- `contribution` on a reason is a SHAP value. Positive pushes the risk up, negative pushes it down.
- `role` is one of `victim`, `collector`, `mule`, `cashout`.

## How the backends fit

Routes only call the `Backend` protocol in `backend.py`. `StubBackend` serves samples. In model mode `AsyncRefreshBackend` (`async_backend.py`) wraps `ml.api_backend.ModelBackend` without changing it: reads use a finished snapshot, `POST /transactions` only queues, and one background thread rebuilds and swaps in a new snapshot. A failed rebuild keeps the old snapshot and the queued rows.

## Tests

```
python -m pytest api/tests -q                    # API only
python -m pytest ml/tests api/tests infra/tests -q   # everything
```
