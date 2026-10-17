"""The seam between the API and the model code.

The routes only talk to a Backend. The default is the stub, which serves invented sample data so
the dashboard and the tests work without any model or data files. Set NEXUSZ_BACKEND=model to serve
the trained model over a transaction slice instead.

Environment variables (all optional):
  NEXUSZ_BACKEND               "stub" (default) or "model"
  NEXUSZ_SLICE                 transaction slice name, default "HI-Slice" (<NEXUSZ_DATA_DIR>/ibm-aml/<slice>_Trans.csv)
  NEXUSZ_DATA_DIR              dataset folder (read by data/paths.py)
  NEXUSZ_BUNDLE                model folder with model.json and meta.json, default ml/artifacts/HI-Small
  NEXUSZ_HISTORY_HOURS         use only the first N hours of the slice as history (for the replay demo)
  NEXUSZ_ACTIVE_HOURS          accounts active in the last N hours are scored, default 24
  NEXUSZ_MIN_REFRESH_SECONDS   least time between rebuilds of the served state, default 5
"""
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from .schemas import AccountScore, Alert, Ring, RingSummary, Transaction

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BUNDLE = "ml/artifacts/HI-Small"
DEFAULT_SLICE = "HI-Slice"
REQUIRED_COLUMNS = ["ts", "src", "dst", "amount", "currency", "receiving_currency", "channel"]


class Backend(Protocol):
    name: str

    def ingest(self, txs: list[Transaction]) -> int: ...
    def list_rings(self) -> list[RingSummary]: ...
    def get_ring(self, ring_id: str) -> Ring | None: ...
    def get_account(self, account_id: str) -> AccountScore | None: ...
    def list_alerts(self, limit: int) -> list[Alert]: ...


class BackendConfigError(RuntimeError):
    """The environment asks for a backend that cannot be built. The message says what to fix."""


def _env_number(name: str, default: float, minimum: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise BackendConfigError(f"{name}={raw!r} is not a number") from None
    if not value >= minimum:  # also rejects NaN
        raise BackendConfigError(f"{name}={raw!r} must be at least {minimum}")
    return value


def split_history(tx, hours: float):
    """Split a time-sorted transaction table: rows in the first `hours` hours, and the rest.

    The streaming simulator uses the same cut for its replay file, so the two always agree.
    """
    import pandas as pd

    cut = tx["ts"].min() + pd.Timedelta(hours=hours)
    return tx[tx["ts"] < cut].reset_index(drop=True), tx[tx["ts"] >= cut].reset_index(drop=True)


def build_model_backend() -> Backend:
    """Load the configured slice and bundle and return the model backend. Raises BackendConfigError."""
    slice_name = os.environ.get("NEXUSZ_SLICE", DEFAULT_SLICE).strip() or DEFAULT_SLICE
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", slice_name):
        raise BackendConfigError(f"NEXUSZ_SLICE={slice_name!r} must be a plain name such as HI-Slice")
    bundle_dir = Path(os.environ.get("NEXUSZ_BUNDLE") or DEFAULT_BUNDLE)
    if not bundle_dir.is_absolute():
        bundle_dir = REPO_ROOT / bundle_dir
    for fname in ("model.json", "meta.json"):
        if not (bundle_dir / fname).is_file():
            raise BackendConfigError(f"NEXUSZ_BACKEND=model but {bundle_dir / fname} does not exist; set NEXUSZ_BUNDLE")
    active_hours = _env_number("NEXUSZ_ACTIVE_HOURS", 24, 1)
    min_refresh = _env_number("NEXUSZ_MIN_REFRESH_SECONDS", 5.0, 0)
    history_hours = _env_number("NEXUSZ_HISTORY_HOURS", 0, 0)

    from data import ibm_aml  # imported late so the stub never needs pandas or the data package

    slice_file = ibm_aml.IBM_AML_DIR / f"{slice_name}_Trans.csv"
    if not slice_file.is_file():
        raise BackendConfigError(
            f"NEXUSZ_BACKEND=model but {slice_file} does not exist; set NEXUSZ_DATA_DIR and NEXUSZ_SLICE "
            f"(make a slice with: python -m ml.make_slice HI-Small 48 {slice_name})")
    tx = ibm_aml.load_transactions(slice_name)
    missing = [c for c in REQUIRED_COLUMNS if c not in tx.columns]
    if missing:
        raise BackendConfigError(f"slice {slice_file} is missing columns {missing}")
    if tx.empty:
        raise BackendConfigError(f"slice {slice_file} has no transactions")
    if history_hours:
        tx, _ = split_history(tx, history_hours)

    from ml.bundle import load_bundle

    from .async_backend import AsyncRefreshBackend

    try:
        bundle = load_bundle(bundle_dir)
    except Exception as exc:  # a corrupt or incompatible bundle must be diagnosable, not silently replaced
        raise BackendConfigError(f"could not load the model bundle {bundle_dir}: {type(exc).__name__}: {exc}") from exc
    return AsyncRefreshBackend(bundle, tx, active_hours=int(active_hours), min_refresh_seconds=min_refresh)


@lru_cache
def get_backend() -> Backend:
    choice = (os.environ.get("NEXUSZ_BACKEND") or "stub").strip().lower()
    if choice == "model":
        return build_model_backend()
    if choice != "stub":
        raise BackendConfigError(f"NEXUSZ_BACKEND={choice!r} is not valid; use 'stub' or 'model'")
    from .stub_backend import StubBackend

    return StubBackend()
