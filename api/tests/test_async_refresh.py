"""Background refresh: reads stay fast and consistent while a slow rebuild runs."""
import threading
import time

import pandas as pd
import pytest

from api.async_backend import AsyncRefreshBackend, build_snapshot

from .conftest import T0, api_tx

LATE = T0 + pd.Timedelta(hours=13)


class SlowBuild:
    """Builder that lets the first call (the initial state) through, then blocks later calls on a gate."""

    def __init__(self):
        self.calls, self.gate, self.entered = 0, threading.Event(), threading.Event()
        self.fail = False

    def __call__(self, bundle, tx, active_hours):
        self.calls += 1
        if self.calls > 1:
            self.entered.set()
            assert self.gate.wait(10), "test never released the gate"
            if self.fail:
                raise RuntimeError("secret internal detail /srv/private/path")
        return build_snapshot(bundle, tx, active_hours)


@pytest.fixture
def slow(tx_and_bundle):
    tx, bundle = tx_and_bundle
    build = SlowBuild()
    backend = AsyncRefreshBackend(bundle, tx, active_hours=48, min_refresh_seconds=0, build=build, autostart=False)
    yield backend, build, tx
    build.gate.set()
    backend.close(timeout=5)


def start_refresh(backend) -> threading.Thread:
    t = threading.Thread(target=backend.refresh_now, kwargs={"wait": True}, daemon=True)
    t.start()
    return t


def test_reads_stay_fast_and_serve_last_state_during_a_slow_refresh(slow):
    backend, build, tx = slow
    before = [r.ring_id for r in backend.list_rings()]
    assert before
    backend.ingest([api_tx("N1", "V0", "NEWACC", LATE)])
    t = start_refresh(backend)
    assert build.entered.wait(5)
    assert backend.health_info()["refreshing"] is True

    started = time.perf_counter()
    for _ in range(20):
        assert [r.ring_id for r in backend.list_rings()] == before
        assert backend.get_account("NEWACC") is None  # not published yet
        assert backend.get_ring(before[0]) is not None
    assert time.perf_counter() - started < 1.0  # 60 reads while the rebuild is blocked

    build.gate.set()
    t.join(10)
    assert backend.get_account("NEWACC") is not None
    info = backend.health_info()
    assert info["refreshing"] is False and info["pending_transactions"] == 0 and info["refreshes_completed"] == 1


def test_transactions_arriving_during_a_refresh_are_kept(slow):
    backend, build, tx = slow
    backend.ingest([api_tx("N1", "V0", "FIRST", LATE)])
    t = start_refresh(backend)
    assert build.entered.wait(5)
    assert backend.ingest([api_tx("N2", "V1", "SECOND", LATE + pd.Timedelta(minutes=1))]) == 1
    assert backend.health_info()["pending_transactions"] == 1
    build.gate.set()
    t.join(10)
    assert backend.get_account("FIRST") is not None and backend.get_account("SECOND") is None
    assert backend.refresh_now(wait=True) is True  # the second batch was not lost
    assert backend.get_account("SECOND") is not None
    assert backend.health_info()["history_transactions"] == len(tx) + 2


def test_only_one_refresh_runs_at_a_time(slow):
    backend, build, _ = slow
    backend.ingest([api_tx("N1", "V0", "NEWACC", LATE)])
    t = start_refresh(backend)
    assert build.entered.wait(5)
    assert backend.refresh_now() is False  # a second caller does not start another rebuild
    backend.ingest([api_tx("N2", "V1", "OTHER", LATE)])
    assert backend.refresh_now() is False
    build.gate.set()
    t.join(10)
    assert build.calls == 2  # the initial build plus exactly one refresh


def test_failed_refresh_keeps_last_good_state_and_the_queued_rows(slow):
    backend, build, tx = slow
    before = [r.ring_id for r in backend.list_rings()]
    build.fail = True
    build.gate.set()
    backend.ingest([api_tx("N1", "V0", "NEWACC", LATE)])
    assert backend.refresh_now(wait=True) is False
    info = backend.health_info()
    assert info["last_error"]["type"] == "RuntimeError"
    assert "secret" not in str(info) and "/srv" not in str(info)  # type and time only, no message
    assert info["pending_transactions"] == 1 and info["refreshes_completed"] == 0
    assert [r.ring_id for r in backend.list_rings()] == before and backend.get_account("NEWACC") is None

    build.fail = False  # recovery: the same rows are retried and the error clears
    assert backend.refresh_now(wait=True) is True
    assert backend.get_account("NEWACC") is not None
    assert backend.health_info()["last_error"] is None


def test_readers_never_fail_while_snapshots_are_swapped(tx_and_bundle):
    tx, bundle = tx_and_bundle
    backend = AsyncRefreshBackend(bundle, tx, active_hours=48, min_refresh_seconds=0, autostart=False)
    errors, stop = [], threading.Event()

    def reader():
        while not stop.is_set():
            try:
                rings = backend.list_rings()
                for r in rings:
                    ring = backend.get_ring(r.ring_id)  # None is legal: ring ids change when membership changes
                    assert ring is None or ring.accounts == len(ring.members)
                backend.list_alerts(20)
                time.sleep(0.005)  # a tight loop would starve the rebuild thread of the GIL and make this test slow
            except Exception as exc:  # noqa: BLE001 - any failure is a test failure
                errors.append(exc)
                return

    threads = [threading.Thread(target=reader, daemon=True) for _ in range(4)]
    [t.start() for t in threads]
    try:
        for i in range(4):
            backend.ingest([api_tx(f"N{i}", "V0", f"NEW{i}", LATE + pd.Timedelta(minutes=i))])
            assert backend.refresh_now(wait=True) is True
    finally:
        stop.set()
        [t.join(5) for t in threads]
    assert errors == []
    assert backend.health_info()["refreshes_completed"] == 4


def test_worker_thread_refreshes_in_background_and_stops_on_close(tx_and_bundle):
    tx, bundle = tx_and_bundle
    backend = AsyncRefreshBackend(bundle, tx, active_hours=48, min_refresh_seconds=0.05)
    try:
        backend.ingest([api_tx("N1", "V0", "NEWACC", LATE)])
        deadline = time.time() + 10
        while backend.get_account("NEWACC") is None and time.time() < deadline:
            time.sleep(0.02)
        assert backend.get_account("NEWACC") is not None
    finally:
        backend.close(timeout=5)
    assert not backend._worker.is_alive()


def test_close_does_not_wait_for_or_publish_a_running_rebuild(slow):
    backend, build, _ = slow
    backend.ingest([api_tx("N1", "V0", "NEWACC", LATE)])
    t = start_refresh(backend)
    assert build.entered.wait(5)
    started = time.perf_counter()
    backend.close(timeout=0.2)
    assert time.perf_counter() - started < 2.0
    build.gate.set()
    t.join(10)
    assert backend.get_account("NEWACC") is None  # discarded, not published after shutdown
    assert backend.health_info()["refreshes_completed"] == 0


def test_health_reports_interval_and_state_age(slow):
    backend, _, tx = slow
    info = backend.health_info()
    assert info["refresh_interval_seconds"] == 0 and info["history_transactions"] == len(tx)
    assert info["state_age_seconds"] >= 0 and info["last_rebuild_seconds"] > 0
    time.sleep(0.05)
    assert backend.health_info()["state_age_seconds"] > info["state_age_seconds"]


def test_alerts_are_precomputed_and_match_the_scorer(slow):
    backend, _, _ = slow
    snap = backend._snapshot.backend
    for limit in (1, 3, 50, 500):
        assert backend.list_alerts(limit) == snap.list_alerts(limit)


def test_ring_member_accounts_are_memoized_per_snapshot_but_others_are_not(slow):
    backend, build, _ = slow
    build.gate.set()
    member = backend.get_ring(backend.list_rings()[0].ring_id).members[0].id
    first = backend.get_account(member)
    assert first.ring_id and backend.get_account(member) is first  # same object: served from the memo
    assert first == backend._snapshot.backend.get_account(member)
    outsider = next(f"B{i}" for i in range(60) if (a := backend.get_account(f"B{i}")) is not None and a.ring_id is None)
    assert outsider not in backend._snapshot.accounts  # the memo stays bounded by ring membership
    backend.ingest([api_tx("N1", "V0", "NEWACC", LATE)])
    assert backend.refresh_now(wait=True)
    assert backend._snapshot.accounts == {}  # a new snapshot starts with an empty memo
