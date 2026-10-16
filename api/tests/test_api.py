from datetime import datetime

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

TX = {"tx_id": "T1", "ts": "2026-10-14T02:10:00Z", "src": "ACC-0001", "dst": "ACC-7F3A", "amount": 2500.0, "channel": "ACH"}


def test_health_names_backend():
    assert client.get("/health").json() == {"status": "ok", "backend": "stub"}


def test_rings_sorted_by_risk_desc():
    rings = client.get("/rings").json()
    risks = [r["risk"] for r in rings]
    assert len(rings) == 3 and risks == sorted(risks, reverse=True)


def test_ring_detail_is_consistent():
    ring = client.get("/rings/RNG-0417").json()
    roles = [m["role"] for m in ring["members"]]
    ids = {m["id"] for m in ring["members"]}
    assert roles.count("cashout") == 1 and roles.count("victim") == ring["victims"] == 21
    assert ring["accounts"] == len(ring["members"])
    assert all(e["src"] in ids and e["dst"] in ids for e in ring["edges"])
    assert ring["edges"] == sorted(ring["edges"], key=lambda e: e["ts"])
    assert ring["first_seen"] <= ring["flagged_at"]


def test_warning_screen_account_is_a_collector():
    acc = client.get("/accounts/ACC-7F3A").json()
    assert acc["role"] == "collector" and acc["ring_id"] == "RNG-0417"
    assert acc["neighborhood"]["in_degree"] > 0 and acc["reasons"]


def test_unknown_ids_return_404():
    assert client.get("/rings/RNG-9999").status_code == 404
    assert client.get("/accounts/ACC-NOPE").status_code == 404


def test_alerts_newest_first_and_limited():
    alerts = client.get("/alerts").json()
    stamps = [datetime.fromisoformat(a["ts"]) for a in alerts]
    assert stamps == sorted(stamps, reverse=True)
    assert {a["type"] for a in alerts} == {"ring", "victim_warning"}
    assert len(client.get("/alerts?limit=2").json()) == 2


def test_ingest_accepts_one_or_many():
    assert client.post("/transactions", json=TX).json() == {"accepted": 1, "backend": "stub"}
    assert client.post("/transactions", json=[TX, TX]).json()["accepted"] == 2


def test_ingest_rejects_bad_amount():
    assert client.post("/transactions", json={**TX, "amount": -5}).status_code == 422
