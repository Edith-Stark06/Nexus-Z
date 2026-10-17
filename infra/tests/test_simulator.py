import csv
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from api.backend import get_backend
from api.main import app
from api.stub_backend import StubBackend
from infra import simulator
from infra.simulator import COLUMNS, Stats, iter_batches, parse_row, replay

GOOD = {"tx_id": "1", "ts": "2022-09-03T10:00:00", "src": "ACC-000001", "dst": "ACC-000002", "amount": "12.5", "channel": "ACH"}


def write_csv(path, rows, columns=COLUMNS):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(columns)
        w.writerows(rows)
    return path


def make_rows(n, start=0):
    return [[str(i), f"2022-09-03T{10 + i // 60:02d}:{i % 60:02d}:00", f"S{i}", f"D{i}", str(10.0 + i), "ACH"]
            for i in range(start, start + n)]


def mock_client(handler):
    return httpx.Client(base_url="http://api.test", transport=httpx.MockTransport(handler))


def ok_handler(request):
    return httpx.Response(200, json={"accepted": len(json.loads(request.content)), "backend": "mock"})


# -- parsing
def test_parse_row_accepts_a_good_row_and_keeps_the_amount():
    assert parse_row(GOOD) == {"tx_id": "1", "ts": "2022-09-03T10:00:00", "src": "ACC-000001",
                               "dst": "ACC-000002", "amount": 12.5, "channel": "ACH"}


@pytest.mark.parametrize("change,reason", [
    ({"amount": "abc"}, "bad amount"), ({"amount": "-1"}, "positive"), ({"amount": "0"}, "positive"),
    ({"amount": "nan"}, "positive"), ({"amount": "inf"}, "positive"), ({"amount": ""}, "bad amount"),
    ({"ts": "yesterday"}, "bad ts"), ({"ts": ""}, "bad ts"), ({"src": " "}, "missing src"),
    ({"dst": ""}, "missing dst"), ({"tx_id": ""}, "missing tx_id"), ({"channel": ""}, "missing channel"),
])
def test_parse_row_rejects_bad_rows_with_a_reason(change, reason):
    with pytest.raises(ValueError, match=reason):
        parse_row({**GOOD, **change})


def test_parse_row_rejects_rows_with_extra_fields():
    with pytest.raises(ValueError, match="too many"):
        parse_row({**GOOD, None: ["extra"]})


# -- batching
def test_batches_keep_file_order_and_sizes(tmp_path):
    path = write_csv(tmp_path / "r.csv", make_rows(25))
    stats = Stats()
    batches = list(iter_batches(path, 10, stats))
    assert [len(b) for b in batches] == [10, 10, 5] and stats.read == 25
    assert [t["tx_id"] for b in batches for t in b] == [str(i) for i in range(25)]


def test_start_row_and_max_rows(tmp_path):
    path = write_csv(tmp_path / "r.csv", make_rows(30))
    stats = Stats()
    ids = [t["tx_id"] for b in iter_batches(path, 4, stats, start_row=5, max_rows=7) for t in b]
    assert ids == [str(i) for i in range(5, 12)] and stats.read == 7


def test_malformed_rows_are_skipped_and_counted_not_sent(tmp_path):
    rows = make_rows(5)
    rows[1][4] = "oops"
    rows[3] = ["x", "bad-time", "S", "D", "5", "ACH"]
    rows.append(["short"])  # too few fields: the missing ones are None
    stats = Stats()
    sent = [t["tx_id"] for b in iter_batches(write_csv(tmp_path / "r.csv", rows), 100, stats) for t in b]
    assert sent == ["0", "2", "4"] and stats.skipped_malformed == 3 and stats.read == 6
    assert any("bad amount" in p for p in stats.problems) and any("bad ts" in p for p in stats.problems)


def test_missing_columns_fail_before_anything_is_sent(tmp_path):
    path = write_csv(tmp_path / "r.csv", [["1", "2"]], columns=["tx_id", "ts"])
    with pytest.raises(ValueError, match="missing columns"):
        list(iter_batches(path, 10, Stats()))


def test_input_is_streamed_not_loaded(tmp_path):
    path = write_csv(tmp_path / "r.csv", make_rows(50))
    gen = iter_batches(path, 10, stats := Stats())
    next(gen)
    assert stats.read == 10  # only the first batch has been read so far
    gen.close()


# -- determinism and the real API routes
def test_replay_is_deterministic(tmp_path):
    path = write_csv(tmp_path / "r.csv", make_rows(40))
    runs = []
    for _ in range(2):
        seen = []
        client = mock_client(lambda req, seen=seen: (seen.append(json.loads(req.content)), ok_handler(req))[1])
        replay(client, path, batch_size=7, progress_every=0)
        runs.append(seen)
    assert runs[0] == runs[1] and sum(len(b) for b in runs[0]) == 40


def test_replay_through_the_real_routes(tmp_path):
    backend = StubBackend()
    app.dependency_overrides[get_backend] = lambda: backend
    try:
        client = TestClient(app)
        stats = replay(client, write_csv(tmp_path / "r.csv", make_rows(23)), batch_size=10, progress_every=0)
    finally:
        app.dependency_overrides.clear()
    assert (stats.submitted, stats.accepted, stats.rejected, stats.failed, stats.batches) == (23, 23, 0, 0, 3)
    assert len(backend.received) == 23 and backend.received[0].tx_id == "0" and backend.received[-1].tx_id == "22"


# -- failures are reported honestly
def test_api_rejection_is_counted_as_rejected_never_accepted(tmp_path):
    client = mock_client(lambda req: httpx.Response(422, json={"detail": "bad"}))
    stats = replay(client, write_csv(tmp_path / "r.csv", make_rows(10)), batch_size=5, max_failures=99, progress_every=0)
    assert (stats.submitted, stats.accepted, stats.rejected, stats.failed_batches) == (10, 0, 10, 2)
    assert "HTTP 422" in stats.problems[0]


def test_short_accepted_count_leaves_the_rest_rejected(tmp_path):
    client = mock_client(lambda req: httpx.Response(200, json={"accepted": 3, "backend": "mock"}))
    stats = replay(client, write_csv(tmp_path / "r.csv", make_rows(5)), batch_size=5, progress_every=0)
    assert (stats.accepted, stats.rejected) == (3, 2)


def test_response_without_accepted_field_is_a_failure(tmp_path):
    client = mock_client(lambda req: httpx.Response(200, json={"hello": 1}))
    stats = replay(client, write_csv(tmp_path / "r.csv", make_rows(5)), batch_size=5, progress_every=0)
    assert stats.accepted == 0 and stats.failed == 5


def test_timeouts_are_retried_a_limited_number_of_times(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ReadTimeout("slow", request=request)

    sleeps = []
    stats = replay(mock_client(handler), write_csv(tmp_path / "r.csv", make_rows(5)), batch_size=5, retries=2,
                   progress_every=0, sleep=sleeps.append)
    assert len(calls) == 3 and stats.failed == 5 and stats.accepted == 0
    assert "ReadTimeout" in stats.problems[0] and sleeps == [0.5, 1.0]


def test_transient_503_then_success_is_accepted(tmp_path):
    state = {"n": 0}

    def handler(request):
        state["n"] += 1
        return httpx.Response(503) if state["n"] == 1 else ok_handler(request)

    stats = replay(mock_client(handler), write_csv(tmp_path / "r.csv", make_rows(5)), batch_size=5,
                   progress_every=0, sleep=lambda s: None)
    assert (stats.accepted, stats.failed, stats.batches) == (5, 0, 1)


def test_replay_aborts_after_repeated_failures(tmp_path):
    client = mock_client(lambda req: httpx.Response(500))
    stats = replay(client, write_csv(tmp_path / "r.csv", make_rows(100)), batch_size=5, retries=0, max_failures=3,
                   progress_every=0, sleep=lambda s: None)
    assert stats.aborted and stats.batches == 3 and stats.accepted == 0


def test_4xx_is_not_retried(tmp_path):
    calls = []
    client = mock_client(lambda req: (calls.append(1), httpx.Response(413))[1])
    replay(client, write_csv(tmp_path / "r.csv", make_rows(5)), batch_size=5, retries=5, progress_every=0)
    assert len(calls) == 1


def test_speed_paces_by_data_time_with_an_injected_clock(tmp_path):
    rows = [[str(i), f"2022-09-03T10:{i:02d}:00", "S", "D", "5", "ACH"] for i in range(4)]  # one row per minute
    now, slept = [0.0], []

    def sleep(s):
        slept.append(s)
        now[0] += s

    replay(mock_client(ok_handler), write_csv(tmp_path / "r.csv", rows), batch_size=1, speed=60.0,
           progress_every=0, sleep=sleep, clock=lambda: now[0])
    assert slept == [pytest.approx(1.0)] * 3  # 60 data seconds per wall second


# -- command line
def test_cli_replay_exit_codes(tmp_path, capsys):
    assert simulator.main(["replay", "--input", str(tmp_path / "missing.csv"), "--url", "http://127.0.0.1:9"]) == 2
    assert "error" in capsys.readouterr().err
    assert simulator.main(["replay", "--input", "x", "--batch-size", "0"]) == 2
    assert simulator.main(["replay", "--input", "x", "--batch-size", "5001"]) == 2


def test_prepare_writes_only_rows_after_the_history_window(tmp_path, monkeypatch):
    from data import ibm_aml

    folder = tmp_path / "ibm-aml"
    folder.mkdir()
    header = ("Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
              "Amount Paid,Payment Currency,Payment Format,Is Laundering\n")
    lines = [f"2022/09/02 {h:02d}:00,1,A{h},1,B{h},{h + 1}.5,US Dollar,{h + 1}.5,US Dollar,ACH,0\n" for h in range(0, 24, 2)]
    (folder / "T_Trans.csv").write_text(header + "".join(lines), encoding="utf-8")
    monkeypatch.setattr(ibm_aml, "IBM_AML_DIR", folder)
    out = tmp_path / "replay.csv"
    assert simulator.prepare("T", 6, out) == (3, 9)  # hours 0, 2, 4 are history
    rows = list(csv.DictReader(open(out, encoding="utf-8")))
    assert len(rows) == 9 and rows[0]["ts"] == "2022-09-02T06:00:00" and float(rows[0]["amount"]) == 7.5
    with pytest.raises(FileExistsError):
        simulator.prepare("T", 6, out)
    assert simulator.main(["prepare", "--slice", "T", "--history-hours", "6", "--out", str(out)]) == 2  # no overwrite
    assert simulator.main(["prepare", "--slice", "NOPE", "--history-hours", "6", "--out", str(tmp_path / "n.csv")]) == 2
