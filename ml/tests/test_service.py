import pandas as pd
import pytest

from api.schemas import AccountScore, Alert, Ring, RingSummary
from ml.features import build_features
from ml.service import Scorer, infer_roles, ring_id


@pytest.fixture(scope="module")
def scorer(tx_and_bundle):
    tx, bundle = tx_and_bundle
    return Scorer(bundle, build_features(tx, bundle.ccy_median), tx, tx["ts"].max())


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
