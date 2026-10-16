"""Backend for the API that serves real model output instead of sample rings.

Implements the Backend protocol from api/backend.py. To switch the API over, in
api/backend.py:get_backend return ModelBackend.from_dir(bundle_folder, history_transactions).

New transactions are queued by ingest and picked up by a full rebuild of features, scores and
rings, at most once every min_refresh_seconds. A rebuild is a full recompute, not an incremental
one, so its cost grows with the amount of history. refresh_seconds records the last cost; report
that measured number, not a promise.
"""
import time
from pathlib import Path

import pandas as pd

from api.schemas import AccountScore, Alert, Ring, RingSummary, Transaction

from .bundle import Bundle, load_bundle
from .service import Scorer

DEFAULT_CURRENCY = "US Dollar"  # the API does not carry currency, so ingested rows assume one


class ModelBackend:
    name = "model"

    def __init__(self, bundle: Bundle, tx: pd.DataFrame, active_hours: int = 24, min_refresh_seconds: float = 5.0):
        self.bundle, self.tx = bundle, tx
        self.active_hours, self.min_refresh_seconds = active_hours, min_refresh_seconds
        self._pending: list[dict] = []
        self.refresh_seconds: float | None = None
        self._last_refresh = 0.0
        self._rebuild()

    @classmethod
    def from_dir(cls, bundle_dir: Path, tx: pd.DataFrame, **kwargs) -> "ModelBackend":
        return cls(load_bundle(Path(bundle_dir)), tx, **kwargs)

    # -- state
    def _rebuild(self) -> None:
        started = time.time()
        if self._pending:
            new = pd.DataFrame(self._pending)
            self.tx = pd.concat([self.tx, new], ignore_index=True).sort_values("ts", kind="stable", ignore_index=True)
            self._pending = []
        since = self.tx["ts"].max() - pd.Timedelta(hours=self.active_hours)
        self.scorer = Scorer.from_transactions(self.bundle, self.tx, active_since=since)
        self.refresh_seconds = time.time() - started
        self._last_refresh = time.time()

    def _fresh(self) -> Scorer:
        if self._pending and time.time() - self._last_refresh >= self.min_refresh_seconds:
            self._rebuild()
        return self.scorer

    # -- Backend protocol
    def ingest(self, txs: list[Transaction]) -> int:
        for t in txs:
            self._pending.append({
                "tx_id": t.tx_id, "ts": pd.Timestamp(t.ts).tz_convert("UTC").tz_localize(None) if t.ts.tzinfo else pd.Timestamp(t.ts),
                "src": t.src, "dst": t.dst, "amount": t.amount, "currency": DEFAULT_CURRENCY,
                "receiving_currency": DEFAULT_CURRENCY, "channel": t.channel, "amount_received": t.amount,
                "is_laundering": 0})
        return len(txs)

    def list_rings(self) -> list[RingSummary]:
        return [RingSummary(**d) for d in self._fresh().list_rings()]

    def get_ring(self, ring_id: str) -> Ring | None:
        d = self._fresh().get_ring(ring_id)
        return Ring(**d) if d else None

    def get_account(self, account_id: str) -> AccountScore | None:
        d = self._fresh().score_account(account_id)
        return AccountScore(**d) if d else None

    def list_alerts(self, limit: int) -> list[Alert]:
        return [Alert(**d) for d in self._fresh().list_alerts(limit)]
