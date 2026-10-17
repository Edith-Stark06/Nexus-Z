"""NEXUS Z API. Run from the repo root:  uvicorn api.main:app --reload --port 8000"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .backend import Backend, BackendConfigError, get_backend
from .schemas import AccountScore, Alert, IngestResult, Ring, RingSummary, Transaction

log = logging.getLogger("nexusz.api")

# Dashboard dev servers. Add more with NEXUSZ_CORS_ORIGINS=http://host:port,http://other:port
DEFAULT_ORIGINS = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"]
MAX_BATCH = 5000  # transactions per POST /transactions


def cors_origins() -> list[str]:
    extra = [o.strip() for o in os.environ.get("NEXUSZ_CORS_ORIGINS", "").split(",") if o.strip()]
    return DEFAULT_ORIGINS + [o for o in extra if o not in DEFAULT_ORIGINS]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build the backend at startup so a bad model or data configuration stops the server with a
    # clear message, instead of failing the first request.
    try:
        backend = get_backend()
    except BackendConfigError as exc:
        log.error("backend configuration error: %s", exc)
        raise
    log.info("serving with the %s backend", backend.name)
    yield
    close = getattr(backend, "close", None)
    if close:
        close()
    get_backend.cache_clear()


app = FastAPI(title="NEXUS Z API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(BackendConfigError)
async def config_error(request, exc: BackendConfigError):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=503, content={"detail": f"backend not available: {exc}"})


@app.get("/health")
def health(backend: Backend = Depends(get_backend)) -> dict:
    """Which backend is active. The model backend adds refresh interval and the age of the served state."""
    body = {"status": "ok", "backend": backend.name}
    info = getattr(backend, "health_info", None)
    if info:
        body.update(info())
        if body.get("last_error"):
            body["status"] = "degraded"  # still serving, but the latest refresh failed
    return body


@app.post("/transactions", response_model=IngestResult)
def ingest(body: Transaction | list[Transaction], backend: Backend = Depends(get_backend)) -> IngestResult:
    txs = body if isinstance(body, list) else [body]
    if len(txs) > MAX_BATCH:
        raise HTTPException(status_code=413, detail=f"At most {MAX_BATCH} transactions per request, got {len(txs)}")
    return IngestResult(accepted=backend.ingest(txs), backend=backend.name)


@app.get("/accounts/{account_id}", response_model=AccountScore)
def get_account(account_id: str, backend: Backend = Depends(get_backend)) -> AccountScore:
    """Also the payment pre-check: 404 means "no information about this account", not "safe"."""
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
