"""NEXUSZ_BACKEND selection, configuration errors, and model mode over a real bundle and a small slice."""
import pytest
from fastapi.testclient import TestClient

from api import backend as backend_mod
from api.backend import BackendConfigError, get_backend, split_history
from api.main import app

from .conftest import make_tx

HEADER = ("Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
          "Amount Paid,Payment Currency,Payment Format,Is Laundering\n")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("NEXUSZ_BACKEND", "NEXUSZ_SLICE", "NEXUSZ_BUNDLE", "NEXUSZ_HISTORY_HOURS",
                 "NEXUSZ_ACTIVE_HOURS", "NEXUSZ_MIN_REFRESH_SECONDS", "NEXUSZ_CORS_ORIGINS"):
        monkeypatch.delenv(name, raising=False)
    get_backend.cache_clear()
    yield
    get_backend.cache_clear()


@pytest.fixture
def slice_dir(tmp_path, monkeypatch):
    """A small slice in the raw IBM format, in a temporary data folder (never the real dataset)."""
    from data import ibm_aml

    folder = tmp_path / "ibm-aml"
    folder.mkdir()
    lines = [HEADER]
    for r in make_tx().itertuples():
        lines.append(f"{r.ts:%Y/%m/%d %H:%M},1,{r.src},1,{r.dst},{r.amount},US Dollar,{r.amount},US Dollar,ACH,0\n")
    (folder / "Tiny_Trans.csv").write_text("".join(lines), encoding="utf-8")
    monkeypatch.setattr(ibm_aml, "IBM_AML_DIR", folder)
    monkeypatch.setenv("NEXUSZ_SLICE", "Tiny")
    return folder


def test_default_is_the_stub_and_needs_no_files():
    assert get_backend().name == "stub"
    with TestClient(app) as client:  # runs startup and shutdown
        assert client.get("/health").json() == {"status": "ok", "backend": "stub"}


def test_unknown_backend_name_is_an_error(monkeypatch):
    monkeypatch.setenv("NEXUSZ_BACKEND", "magic")
    with pytest.raises(BackendConfigError, match="not valid"):
        get_backend()


@pytest.mark.parametrize("var,value,message", [
    ("NEXUSZ_SLICE", "../secret", "plain name"),
    ("NEXUSZ_ACTIVE_HOURS", "lots", "not a number"),
    ("NEXUSZ_MIN_REFRESH_SECONDS", "-1", "at least"),
    ("NEXUSZ_HISTORY_HOURS", "nan", "at least"),
])
def test_bad_numbers_and_names_are_rejected(monkeypatch, var, value, message):
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    monkeypatch.setenv(var, value)
    monkeypatch.setenv("NEXUSZ_BUNDLE", str(backend_mod.REPO_ROOT / backend_mod.DEFAULT_BUNDLE))
    with pytest.raises(BackendConfigError, match=message):
        get_backend()


def test_missing_bundle_is_reported_with_the_path(monkeypatch, tmp_path):
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    monkeypatch.setenv("NEXUSZ_BUNDLE", str(tmp_path / "nope"))
    with pytest.raises(BackendConfigError, match="model.json"):
        get_backend()


def test_missing_slice_is_reported_with_the_fix(monkeypatch, tmp_path):
    from data import ibm_aml

    monkeypatch.setattr(ibm_aml, "IBM_AML_DIR", tmp_path)
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    with pytest.raises(BackendConfigError, match="make_slice"):
        get_backend()


def test_corrupt_bundle_does_not_fall_back_to_the_stub(monkeypatch, tmp_path, slice_dir):
    (tmp_path / "bad").mkdir()
    (tmp_path / "bad" / "model.json").write_text("not a model")
    (tmp_path / "bad" / "meta.json").write_text("{}")
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    monkeypatch.setenv("NEXUSZ_BUNDLE", str(tmp_path / "bad"))
    with pytest.raises(BackendConfigError, match="could not load the model bundle"):
        get_backend()


def test_startup_fails_loudly_on_bad_configuration(monkeypatch, tmp_path):
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    monkeypatch.setenv("NEXUSZ_BUNDLE", str(tmp_path / "nope"))
    with pytest.raises(BackendConfigError):
        with TestClient(app):
            pass


def test_model_mode_serves_the_real_bundle_over_the_slice(monkeypatch, slice_dir):
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    monkeypatch.setenv("NEXUSZ_ACTIVE_HOURS", "48")
    monkeypatch.setenv("NEXUSZ_MIN_REFRESH_SECONDS", "0.05")
    with TestClient(app) as client:
        health = client.get("/health").json()
        assert health["backend"] == "model" and health["status"] == "ok"
        assert health["refresh_interval_seconds"] == 0.05
        assert health["history_transactions"] == len(make_tx()) and health["state_age_seconds"] >= 0
        assert client.get("/rings").status_code == 200
        assert client.get("/alerts").status_code == 200
        assert client.get("/accounts/ACC-ZZZZ").status_code == 404
    assert not get_backend.cache_info().currsize  # shutdown released the backend


def test_history_hours_keeps_only_the_first_hours(monkeypatch, slice_dir):
    monkeypatch.setenv("NEXUSZ_BACKEND", "model")
    monkeypatch.setenv("NEXUSZ_HISTORY_HOURS", "6")
    with TestClient(app) as client:
        history, rest = split_history(make_tx(), 6)
        assert len(history) and len(rest)
        assert client.get("/health").json()["history_transactions"] == len(history)


def test_cors_origins_can_be_extended(monkeypatch):
    from api.main import DEFAULT_ORIGINS, cors_origins

    monkeypatch.setenv("NEXUSZ_CORS_ORIGINS", "http://dash.example:4000, http://localhost:3000")
    assert cors_origins() == DEFAULT_ORIGINS + ["http://dash.example:4000"]


def test_oversized_batch_is_refused():
    tx = {"tx_id": "T", "ts": "2026-10-14T02:10:00Z", "src": "A", "dst": "B", "amount": 1.0, "channel": "ACH"}
    from api.main import MAX_BATCH

    client = TestClient(app)
    assert client.post("/transactions", json=[tx] * (MAX_BATCH + 1)).status_code == 413
    assert client.post("/transactions", json=[tx] * 3).json()["accepted"] == 3
