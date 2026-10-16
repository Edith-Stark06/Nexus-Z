import numpy as np
import pandas as pd
import pytest
from xgboost import XGBClassifier

from api.schemas import AccountScore, Alert, Ring, RingSummary
from ml.bundle import ALL_COLS, Bundle
from ml.features import build_features
from ml.service import Scorer, infer_roles, ring_id


def make_tx():
    rng = np.random.default_rng(0)
    t0 = pd.Timestamp("2022-09-02 00:00")
    rows = []
    victims = [f"V{i}" for i in range(12)]
    for i, v in enumerate(victims):  # victims pay two collectors, who forward within minutes to mules, then one cash-out
        c = "C0" if i % 2 == 0 else "C1"
        t = t0 + pd.Timedelta(minutes=30 * i)
        rows += [(t, v, c, 500.0), (t + pd.Timedelta(minutes=4), c, "M0" if c == "C0" else "M1", 450.0),
                 (t + pd.Timedelta(minutes=9), "M0" if c == "C0" else "M1", "OUT", 400.0)]
    for _ in range(300):  # background traffic between ordinary accounts
        a, b = rng.choice(60, 2, replace=False)
        rows.append((t0 + pd.Timedelta(minutes=int(rng.integers(0, 720))), f"B{a}", f"B{b}", float(rng.integers(20, 300))))
    tx = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount"]).sort_values("ts", ignore_index=True)
    tx["currency"] = tx["receiving_currency"] = "US Dollar"
    tx["channel"] = "ACH"
    return tx


@pytest.fixture(scope="module")
def scorer():
    tx = make_tx()
    med = {"US Dollar": 100.0}
    X = build_features(tx, med)
    y = X.index.str.match(r"^(V|C|M|O)").astype(int)
    model = XGBClassifier(n_estimators=30, max_depth=3, tree_method="hist", random_state=0).fit(X[ALL_COLS], y)
    bundle = Bundle(model, ALL_COLS, 0.5, 0.2, med, {}, calibration=(1.0, -2.0))
    return Scorer(bundle, X, tx, tx["ts"].max())


def test_roles_follow_position_in_the_ring():
    inside = pd.DataFrame({"src": ["v1", "v2", "c", "m"], "dst": ["c", "c", "m", "out"]})
    roles = infer_roles(["v1", "v2", "c", "m", "out"], inside)
    assert roles == {"v1": "victim", "v2": "victim", "c": "collector", "m": "mule", "out": "cashout"}


def test_ring_found_and_matches_api_schema(scorer):
    assert scorer.rings, "expected the planted ring to be detected"
    summaries = scorer.list_rings()
    for s in summaries:
        RingSummary(**s)
    ring = scorer.get_ring(summaries[0]["ring_id"])
    Ring(**ring)
    assert ring["ring_id"] == ring_id([m["id"] for m in ring["members"]])
    assert {m["id"] for m in ring["members"]} & {"C0", "C1", "OUT"}
    assert [e["ts"] for e in ring["edges"]] == sorted(e["ts"] for e in ring["edges"])
    assert len(ring["top_reasons"]) == 5


def test_account_score_matches_api_schema(scorer):
    rid = scorer.list_rings()[0]["ring_id"]
    member = scorer.get_ring(rid)["members"][0]["id"]
    acc = scorer.score_account(member)
    AccountScore(**acc)
    assert acc["ring_id"] == rid and acc["role"] is not None and len(acc["reasons"]) == 3
    assert scorer.score_account("nobody") is None and scorer.get_ring("RNG-NOPE") is None


def test_explanations_are_sorted_by_strength(scorer):
    reasons = scorer.explain("C0", k=5)
    strengths = [abs(r["contribution"]) for r in reasons]
    assert strengths == sorted(strengths, reverse=True) and all(r["label"] for r in reasons)


def test_alerts_match_api_schema_and_are_newest_first(scorer):
    alerts = scorer.list_alerts()
    for a in alerts:
        Alert(**a)
    assert [a["ts"] for a in alerts] == sorted((a["ts"] for a in alerts), reverse=True)
    assert any(a["type"] == "ring" for a in alerts)
