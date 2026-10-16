# NEXUS Z API

FastAPI service for the dashboard. Currently backed by a **stub** that serves invented sample rings, so the dashboard can be built before the real model exists. Every ID, amount and ring here is made up.

## Run

From the repo root:

```
pip install -r api/requirements.txt
uvicorn api.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs. CORS allows the dashboard dev servers on ports 3000 and 5173.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /health` | `{"status": "ok", "backend": "stub"}`. The backend name shows whether you are seeing sample data |
| `POST /transactions` | Accepts one transaction or a list. Fields: `tx_id, ts, src, dst, amount, channel` |
| `GET /rings` | Ring summaries, highest risk first |
| `GET /rings/{ring_id}` | Members with roles, time-ordered edges (for the replay slider), top reasons |
| `GET /accounts/{account_id}` | Account risk, role, ring, reasons, neighborhood |
| `GET /alerts?limit=50` | Ring alerts and victim warnings, newest first |

Sample IDs to try: `RNG-0417`, `RNG-0392`, `RNG-0455`, and `ACC-7F3A` (a collector in `RNG-0417`, the account in the warning screen).

## No server? Use the example files

`api/examples/*.json` hold the same responses. Regenerate them with `python -m api.export_examples`.

## Contract notes

- Response shapes live in `schemas.py`. Change them only by agreement, since the dashboard depends on them.
- `risk` is 0 to 100 on rings and 0 to 1 on accounts.
- `contribution` on a reason is a SHAP value. Positive pushes the risk up, negative pushes it down.
- `role` is one of `victim`, `collector`, `mule`, `cashout`.

## Swapping in the real model

Routes only call the `Backend` protocol in `backend.py`. The real backend (model functions plus the live graph) implements the same five methods and replaces `StubBackend` in `get_backend()`. No route changes.

## Tests

```
python -m pytest api/tests -q
```
