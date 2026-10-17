"""Model backend whose refresh runs in the background.

ml.api_backend.ModelBackend rebuilds features, scores and rings inside the request that happens to
follow a pending ingest, so that request waits for the whole rebuild. This wrapper keeps ModelBackend
unchanged and coordinates it from outside:

* Requests read one immutable snapshot (a finished ModelBackend). Nothing mutates it afterwards.
* ingest only appends to a locked queue. A single worker thread drains the queue, builds a NEW
  ModelBackend from history + queued rows (and describes every ring, so the first /rings call on the
  new state is not slow), then publishes it by replacing one reference.
* If the build fails, the queued rows go back to the front of the queue and the old snapshot keeps
  being served.

This is still micro-batch rescoring: every refresh recomputes features for all history. It is not
per-transaction incremental scoring.
"""
import inspect
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import pandas as pd

from ml.api_backend import DEFAULT_CURRENCY, ModelBackend
from ml.bundle import Bundle

from .schemas import AccountScore, Alert, Ring, RingSummary, Transaction

log = logging.getLogger("nexusz.refresh")

Builder = Callable[[Bundle, pd.DataFrame, int], ModelBackend]
MAX_BACKOFF_SECONDS = 60.0
MAX_ALERTS = 500  # the API caps /alerts?limit at 500


def build_snapshot(bundle: Bundle, tx: pd.DataFrame, active_hours: int, previous_rings: dict | None = None) -> ModelBackend:
    """Full rebuild, then describe all rings once so served reads hit a warm cache.

    `previous_rings` (ring id -> members, from the snapshot being replaced) lets a ring that grew keep its id."""
    state = ModelBackend(bundle, tx, active_hours=active_hours, min_refresh_seconds=0, previous_rings=previous_rings)
    state.list_rings()
    return state


def _row(t: Transaction) -> dict:
    """One ingested transaction as a history row; same conversion as ModelBackend.ingest."""
    ts = pd.Timestamp(t.ts)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return {"tx_id": t.tx_id, "ts": ts, "src": t.src, "dst": t.dst, "amount": t.amount,
            "currency": DEFAULT_CURRENCY, "receiving_currency": DEFAULT_CURRENCY, "channel": t.channel,
            "amount_received": t.amount, "is_laundering": 0}


@dataclass(frozen=True)
class _Snapshot:
    backend: ModelBackend
    built_at: float          # time.monotonic() when it was published
    rebuild_seconds: float
    data_as_of: datetime | None
    transactions: int
    alerts: list[Alert]      # the 500 newest alerts, computed once in the background thread
    accounts: dict           # ring-member answers, filled on first request (bounded by ring membership)


class AsyncRefreshBackend:
    name = "model"

    def __init__(self, bundle: Bundle, tx: pd.DataFrame, active_hours: int = 24,
                 min_refresh_seconds: float = 5.0, build: Builder = build_snapshot, autostart: bool = True):
        self.bundle, self.active_hours, self.min_refresh_seconds = bundle, active_hours, min_refresh_seconds
        self._build = build
        self._build_remembers_rings = "previous_rings" in inspect.signature(build).parameters  # test builders take three arguments
        self._ring_memory: dict | None = None   # ring ids and members of the snapshot being served
        self._lock = threading.Lock()          # guards _pending, _snapshot, status fields
        self._refresh_lock = threading.Lock()  # only one refresh at a time
        self._pending: list[dict] = []
        self._refreshing = False
        self._refresh_count = 0
        self._last_error: dict | None = None
        self._failures = 0
        self._last_started = float("-inf")
        self._stop, self._wake = threading.Event(), threading.Event()
        started = time.monotonic()
        self._snapshot = self._make_snapshot(self._build_state(tx), started)
        self._worker = threading.Thread(target=self._run, name="nexusz-refresh", daemon=True)
        if autostart:
            self._worker.start()

    # -- snapshot handling
    def _build_state(self, tx: pd.DataFrame) -> ModelBackend:
        """A new state from `tx`; its rings keep the ids of the ring snapshot being served, so open pages stay valid."""
        if self._build_remembers_rings:
            state = self._build(self.bundle, tx, self.active_hours, previous_rings=self._ring_memory)
        else:
            state = self._build(self.bundle, tx, self.active_hours)
        self._ring_memory = state.ring_members() if hasattr(state, "ring_members") else None
        return state

    @staticmethod
    def _make_snapshot(state: ModelBackend, started: float) -> _Snapshot:
        newest = state.tx["ts"].max()
        as_of = None if pd.isna(newest) else newest.to_pydatetime().replace(tzinfo=timezone.utc)
        # Scorer.list_alerts rescans all history for every ring (about 0.6 s at 650k rows), so do it here, not per request.
        # The answer for a smaller limit is a prefix of this one: alerts are sorted, then cut to `limit`.
        alerts = state.list_alerts(MAX_ALERTS)
        return _Snapshot(state, time.monotonic(), time.monotonic() - started, as_of, len(state.tx), alerts, {})

    def refresh_now(self, wait: bool = False) -> bool:
        """Rebuild from the queued rows. Returns True if a new snapshot was published.

        Returns False when nothing was queued, when another refresh is already running (unless
        wait=True), or when the build failed (the old snapshot stays; see health_info).
        """
        if not self._refresh_lock.acquire(blocking=wait):
            return False
        try:
            with self._lock:
                batch, self._pending = self._pending, []
                base = self._snapshot
            if not batch:
                return False
            started = time.monotonic()
            self._last_started = started
            self._refreshing = True
            try:
                merged = pd.concat([base.backend.tx, pd.DataFrame(batch)], ignore_index=True)
                merged = merged.sort_values("ts", kind="stable", ignore_index=True)
                fresh = self._make_snapshot(self._build_state(merged), started)
            except Exception as exc:
                log.exception("refresh failed; still serving the previous state")
                with self._lock:
                    self._pending = batch + self._pending  # nothing queued is lost
                    self._failures += 1
                    self._last_error = {"type": type(exc).__name__,
                                        "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
                return False
            finally:
                self._refreshing = False
            if self._stop.is_set():
                return False  # shutting down: do not publish work nobody will read
            with self._lock:
                self._snapshot = fresh
                self._refresh_count += 1
                self._failures = 0
                self._last_error = None
            return True
        finally:
            self._refresh_lock.release()

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.wait()
            if self._stop.is_set():
                break
            self._wake.clear()
            gap = self.min_refresh_seconds - (time.monotonic() - self._last_started)
            if gap > 0 and self._stop.wait(gap):
                break
            if not self.refresh_now() and self._failures:
                backoff = min(MAX_BACKOFF_SECONDS, max(self.min_refresh_seconds, 1.0) * 2 ** min(self._failures, 6))
                if self._stop.wait(backoff):
                    break
                self._wake.set()  # retry the same rows

    def close(self, timeout: float = 30.0) -> None:
        """Stop the worker. A rebuild already running finishes in the background but is not published."""
        self._stop.set()
        self._wake.set()
        if self._worker.is_alive():
            self._worker.join(timeout)

    # -- Backend protocol
    def ingest(self, txs: list[Transaction]) -> int:
        rows = [_row(t) for t in txs]
        with self._lock:
            self._pending.extend(rows)
        if rows:
            self._wake.set()
        return len(rows)

    def list_rings(self) -> list[RingSummary]:
        return self._snapshot.backend.list_rings()

    def get_ring(self, ring_id: str) -> Ring | None:
        return self._snapshot.backend.get_ring(ring_id)

    def get_account(self, account_id: str) -> AccountScore | None:
        snap = self._snapshot
        if account_id in snap.accounts:
            return snap.accounts[account_id]
        account = snap.backend.get_account(account_id)
        if account is not None and account.ring_id is not None:  # ring members cost ~0.1 s (role inference scans history)
            snap.accounts[account_id] = account
        return account

    def list_alerts(self, limit: int) -> list[Alert]:
        return self._snapshot.alerts[:limit]

    # -- freshness, shown in /health
    def health_info(self) -> dict:
        with self._lock:
            snap, pending, err = self._snapshot, len(self._pending), self._last_error
            count, refreshing = self._refresh_count, self._refreshing
        return {
            "refresh_mode": "background micro-batch rebuild",
            "refresh_interval_seconds": self.min_refresh_seconds,
            "state_age_seconds": round(time.monotonic() - snap.built_at, 3),
            "last_rebuild_seconds": round(snap.rebuild_seconds, 3),
            "data_as_of": snap.data_as_of.isoformat() if snap.data_as_of else None,
            "history_transactions": snap.transactions,
            "pending_transactions": pending,
            "refreshing": refreshing,
            "refreshes_completed": count,
            "last_error": err,
        }
