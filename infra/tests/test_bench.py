import json

import httpx
import pytest

from infra import bench


def test_percentile_is_nearest_rank():
    data = list(range(1, 101))
    assert bench.percentile(data, 50) == 50 and bench.percentile(data, 95) == 95 and bench.percentile(data, 100) == 100
    assert bench.percentile([7.0], 95) == 7.0
    assert bench.percentile([3, 1, 2], 50) == 2  # input order does not matter


def test_summarize_and_recorder_count_errors():
    assert bench.summarize([]) == {"n": 0}
    rec = bench.Recorder()
    rec.add("GET /x", 10.0, True)
    rec.add("GET /x", 30.0, False)
    out = rec.report()["GET /x"]
    assert out["n"] == 2 and out["errors"] == 1 and out["max_ms"] == 30.0 and out["mean_ms"] == 20.0


def test_timed_records_transport_errors_as_failures():
    def boom(request):
        raise httpx.ConnectError("down", request=request)

    client = httpx.Client(base_url="http://api.test", transport=httpx.MockTransport(boom))
    rec = bench.Recorder()
    assert bench.timed(client, rec, "GET /health", "GET", "/health") is None
    assert rec.report()["GET /health"]["errors"] == 1


def test_feed_never_repeats_a_row(tmp_path):
    path = tmp_path / "r.csv"
    path.write_text("tx_id,ts,src,dst,amount,channel\n" + "".join(
        f"{i},2022-09-03T10:00:00,S{i},D{i},5.0,ACH\n" for i in range(10)), encoding="utf-8")
    feed = bench.Feed(path, start_row=2)
    ids = [t["tx_id"] for t in feed.take(3) + feed.take(3) + feed.take(10)]
    assert ids == [str(i) for i in range(2, 10)] and feed.take(5) == [] and feed.used == 8


def test_freshness_probe_measures_until_the_account_appears():
    state = {"gets": 0, "posts": 0}

    def handler(request):
        if request.url.path == "/health":
            return httpx.Response(200, json={"refreshing": False, "pending_transactions": 0,
                                             "data_as_of": "2022-09-03T10:00:00+00:00", "refresh_interval_seconds": 5})
        if request.method == "POST":
            state["posts"] += 1
            return httpx.Response(200, json={"accepted": 1, "backend": "model"})
        state["gets"] += 1
        return httpx.Response(404 if state["gets"] < 3 else 200, json={})

    client = httpx.Client(base_url="http://api.test", transport=httpx.MockTransport(handler))
    out = bench.phase_freshness(client, "ACC-1", probes=1, timeout=5, poll=0.01)
    assert out["probes"][0]["timed_out"] is False and out["probes"][0]["seconds_until_visible"] is not None
    assert state["posts"] == 1 and state["gets"] == 3


def test_probe_that_never_appears_is_reported_as_timed_out():
    def handler(request):
        if request.url.path == "/health":
            return httpx.Response(200, json={"refreshing": False, "pending_transactions": 0})
        return httpx.Response(200, json={"accepted": 1}) if request.method == "POST" else httpx.Response(404, json={})

    client = httpx.Client(base_url="http://api.test", transport=httpx.MockTransport(handler))
    out = bench.phase_freshness(client, "ACC-1", probes=1, timeout=0.2, poll=0.02)
    assert out["probes"][0]["timed_out"] is True and out["max_s"] is None
