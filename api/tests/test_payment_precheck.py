"""Payment pre-check ("Check before you send") through GET /accounts/{destination} and GET /alerts.

The model is a tiny one trained on a planted ring, so these tests check behaviour and wording, not
the accuracy of the victim rule (which has not been evaluated).
"""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api.async_backend import AsyncRefreshBackend
from api.backend import get_backend
from api.main import app
from api.schemas import AccountScore

from .conftest import T0, api_tx


@pytest.fixture
def client(tx_and_bundle):
    tx, bundle = tx_and_bundle
    backend = AsyncRefreshBackend(bundle, tx, active_hours=48, min_refresh_seconds=0, autostart=False)
    app.dependency_overrides[get_backend] = lambda: backend
    yield TestClient(app), backend
    app.dependency_overrides.clear()
    backend.close(timeout=5)


def test_flagged_destination_reports_ring_role_and_reasons(client):
    c, backend = client
    ring = c.get(f"/rings/{c.get('/rings').json()[0]['ring_id']}").json()
    acc = c.get(f"/accounts/{ring['members'][0]['id']}").json()
    assert acc["ring_id"] == ring["ring_id"] and acc["role"] in {"victim", "collector", "mule", "cashout"}
    assert acc["reasons"] and acc["neighborhood"]["ring_size"] == ring["accounts"]
    assert set(acc) == set(AccountScore.model_fields)  # the contract the dashboard depends on


def test_ordinary_destination_has_no_ring(client):
    c, _ = client
    flagged = {m["id"] for r in c.get("/rings").json() for m in c.get(f"/rings/{r['ring_id']}").json()["members"]}
    ordinary = next(f"B{i}" for i in range(60) if f"B{i}" not in flagged and c.get(f"/accounts/B{i}").status_code == 200)
    acc = c.get(f"/accounts/{ordinary}").json()
    assert acc["ring_id"] is None and acc["role"] is None and acc["neighborhood"]["ring_size"] is None


def test_unknown_destination_is_404_meaning_no_information(client):
    c, _ = client
    r = c.get("/accounts/NEVER-SEEN")
    assert r.status_code == 404 and "Unknown account" in r.json()["detail"]


def test_new_destination_is_unknown_until_the_refresh_publishes_it(client):
    c, backend = client
    backend.ingest([api_tx("L1", "B16", "LONELY", T0 + pd.Timedelta(hours=12, minutes=30))])
    assert c.get("/accounts/LONELY").status_code == 404  # queued, not scored yet: no information, not "safe"
    assert backend.refresh_now(wait=True)
    acc = c.get("/accounts/LONELY").json()
    assert set(acc) == set(AccountScore.model_fields)
    ring_ids = {r["ring_id"] for r in c.get("/rings").json()}
    assert acc["ring_id"] is None or acc["ring_id"] in ring_ids  # consistent with what /rings shows


def test_recent_payer_into_a_ring_gets_a_cautious_warning(client):
    c, backend = client
    assert not [a for a in c.get("/alerts?limit=500").json() if a["type"] == "victim_warning"]
    backend.ingest([api_tx("W1", "B16", "C0", T0 + pd.Timedelta(hours=12, minutes=30))])  # an ordinary account pays a collector
    assert backend.refresh_now(wait=True)
    warnings = [a for a in c.get("/alerts?limit=500").json() if a["type"] == "victim_warning"]
    mine = [a for a in warnings if a["account_id"] == "B16"]
    assert mine, "the outside payer into a flagged ring should be listed"
    text = mine[0]["message"].lower()
    assert "flagged ring" in text and not any(w in text for w in ("fraud", "scam", "stolen", "criminal", "guilty"))
    assert mine[0]["severity"] == "medium" and mine[0]["ring_id"] in {r["ring_id"] for r in c.get("/rings").json()}
    assert mine[0]["recipient_id"] == "C0"  # the ring account that was paid, so the warning screen can look it up
    assert c.get("/accounts/C0").json()["ring_id"] == mine[0]["ring_id"]


def test_without_recent_outside_payers_there_are_no_victim_warnings(client):
    c, _ = client
    alerts = c.get("/alerts?limit=500").json()
    assert alerts and all(a["type"] == "ring" for a in alerts)  # the planted victims are inside the ring
    assert all(set(a) == {"alert_id", "type", "severity", "ring_id", "account_id", "recipient_id", "message", "ts"} for a in alerts)


def test_stub_precheck_for_the_demo_collector():
    app.dependency_overrides.clear()
    get_backend.cache_clear()
    c = TestClient(app)
    acc = c.get("/accounts/ACC-7F3A").json()
    assert acc["ring_id"] == "RNG-0417" and c.get("/accounts/ACC-NOPE").status_code == 404
