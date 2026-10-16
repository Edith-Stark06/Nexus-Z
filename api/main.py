"""NEXUS Z API. Run from the repo root:  uvicorn api.main:app --reload --port 8000"""
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .backend import Backend, get_backend
from .schemas import AccountScore, Alert, IngestResult, Ring, RingSummary, Transaction

app = FastAPI(title="NEXUS Z API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # dashboard dev servers
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health(backend: Backend = Depends(get_backend)) -> dict:
    return {"status": "ok", "backend": backend.name}


@app.post("/transactions", response_model=IngestResult)
def ingest(body: Transaction | list[Transaction], backend: Backend = Depends(get_backend)) -> IngestResult:
    txs = body if isinstance(body, list) else [body]
    return IngestResult(accepted=backend.ingest(txs), backend=backend.name)


@app.get("/accounts/{account_id}", response_model=AccountScore)
def get_account(account_id: str, backend: Backend = Depends(get_backend)) -> AccountScore:
    account = backend.get_account(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Unknown account {account_id}")
    return account


@app.get("/rings", response_model=list[RingSummary])
def list_rings(backend: Backend = Depends(get_backend)) -> list[RingSummary]:
    return sorted(backend.list_rings(), key=lambda r: r.risk, reverse=True)


@app.get("/rings/{ring_id}", response_model=Ring)
def get_ring(ring_id: str, backend: Backend = Depends(get_backend)) -> Ring:
    ring = backend.get_ring(ring_id)
    if ring is None:
        raise HTTPException(status_code=404, detail=f"Unknown ring {ring_id}")
    return ring


@app.get("/alerts", response_model=list[Alert])
def list_alerts(limit: int = Query(50, ge=1, le=500), backend: Backend = Depends(get_backend)) -> list[Alert]:
    return backend.list_alerts(limit)
