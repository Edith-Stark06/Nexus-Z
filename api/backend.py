"""The seam between the API and the model code.

The routes only talk to a Backend. The stub backend serves sample data so the dashboard can be
built now; the real backend (Giridharan's scoring functions plus the live graph) replaces it later
without any route changes.
"""
from functools import lru_cache
from typing import Protocol

from .schemas import AccountScore, Alert, Ring, RingSummary, Transaction


class Backend(Protocol):
    name: str

    def ingest(self, txs: list[Transaction]) -> int: ...
    def list_rings(self) -> list[RingSummary]: ...
    def get_ring(self, ring_id: str) -> Ring | None: ...
    def get_account(self, account_id: str) -> AccountScore | None: ...
    def list_alerts(self, limit: int) -> list[Alert]: ...


@lru_cache
def get_backend() -> Backend:
    from .stub_backend import StubBackend

    return StubBackend()
