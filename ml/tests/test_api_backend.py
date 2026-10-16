import pandas as pd

from api.schemas import AccountScore, Alert, Ring, RingSummary, Transaction
from ml.api_backend import ModelBackend


def test_backend_serves_model_output_in_api_types(tx_and_bundle):
    tx, bundle = tx_and_bundle
    backend = ModelBackend(bundle, tx, active_hours=48)
    rings = backend.list_rings()
    assert rings and all(isinstance(r, RingSummary) for r in rings)
    ring = backend.get_ring(rings[0].ring_id)
    assert isinstance(ring, Ring) and isinstance(backend.get_account(ring.members[0].id), AccountScore)
    assert all(isinstance(a, Alert) for a in backend.list_alerts(10))
    assert backend.get_ring("RNG-NOPE") is None and backend.get_account("nobody") is None
    assert backend.refresh_seconds is not None and backend.name == "model"


def test_ingested_transactions_appear_after_a_refresh(tx_and_bundle):
    tx, bundle = tx_and_bundle
    backend = ModelBackend(bundle, tx, active_hours=48, min_refresh_seconds=0)
    when = tx["ts"].max() + pd.Timedelta(minutes=5)
    new = Transaction(tx_id="NEW1", ts=when.to_pydatetime(), src="V0", dst="NEWACC", amount=500.0, channel="ACH")
    assert backend.ingest([new]) == 1
    assert backend.get_account("NEWACC") is not None  # the read triggered a rebuild that includes it
    assert len(backend.tx) == len(tx) + 1


def test_real_api_routes_work_with_the_model_backend(tx_and_bundle):
    """The API's own routes, with the model backend swapped in for the sample one."""
    from fastapi.testclient import TestClient

    from api.backend import get_backend
    from api.main import app

    tx, bundle = tx_and_bundle
    backend = ModelBackend(bundle, tx, active_hours=48, min_refresh_seconds=0)
    app.dependency_overrides[get_backend] = lambda: backend
    try:
        client = TestClient(app)
        assert client.get("/health").json() == {"status": "ok", "backend": "model"}
        rings = client.get("/rings").json()
        assert rings and [r["risk"] for r in rings] == sorted((r["risk"] for r in rings), reverse=True)
        ring = client.get(f"/rings/{rings[0]['ring_id']}").json()
        assert ring["members"] and ring["edges"] and len(ring["top_reasons"]) == 5
        member = ring["members"][0]["id"]
        assert client.get(f"/accounts/{member}").json()["ring_id"] == rings[0]["ring_id"]
        assert client.get("/alerts?limit=5").status_code == 200
        assert client.get("/rings/RNG-NOPE").status_code == 404
        body = {"tx_id": "N1", "ts": "2022-09-03T00:00:00Z", "src": "V0", "dst": "BRANDNEW", "amount": 500.0, "channel": "ACH"}
        assert client.post("/transactions", json=body).json() == {"accepted": 1, "backend": "model"}
        assert client.get("/accounts/BRANDNEW").status_code == 200   # picked up by the rebuild
    finally:
        app.dependency_overrides.clear()
