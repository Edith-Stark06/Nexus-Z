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


def test_ring_is_described_once_and_reused(scorer):
    rid = scorer.list_rings()[0]["ring_id"]
    assert scorer.get_ring(rid) is scorer.get_ring(rid)       # same object: no recomputation
    scorer.list_rings(), scorer.list_alerts()                  # these reuse the cache as well
    assert rid in scorer._ring_cache


def test_two_stage_bundle_scores_explains_and_matches_the_api_schema(tx_and_two_stage_bundle):
    from ml.neighbors import NEIGHBOR_COLS

    tx, bundle = tx_and_two_stage_bundle
    scorer = Scorer.from_transactions(bundle, tx)
    assert scorer._booster is bundle.stage2 and set(NEIGHBOR_COLS) <= set(scorer._frame.columns)
    rings = scorer.list_rings()
    assert rings
    for s in rings:
        RingSummary(**s)
    ring = scorer.get_ring(rings[0]["ring_id"])
    Ring(**ring)
    member = ring["members"][0]["id"]
    AccountScore(**scorer.score_account(member))
    reasons = {r["feature"] for r in scorer.explain(member, k=len(bundle.cols2))}
    assert reasons <= set(bundle.cols2) and all(isinstance(r, str) for r in reasons)


def test_two_stage_bundle_survives_save_and_load(tx_and_two_stage_bundle, tmp_path):
    import numpy as np
    from ml.bundle import load_bundle, save_bundle

    tx, bundle = tx_and_two_stage_bundle
    save_bundle(bundle, tmp_path)
    loaded = load_bundle(tmp_path)
    assert loaded.stage2 is not None and loaded.high_quantile == 0.9 and loaded.cols2 == bundle.cols2
    a, b = Scorer.from_transactions(bundle, tx), Scorer.from_transactions(loaded, tx)
    assert np.allclose(a.scores.to_numpy(), b.scores.to_numpy())


def test_payment_level_scoring_rings_and_explanations(tx_and_payment_bundle):
    tx, bundle = tx_and_payment_bundle
    scorer = Scorer.from_transactions(bundle, tx)
    assert scorer._payment_mode
    rings = scorer.list_rings()
    assert rings
    for s in rings:
        RingSummary(**s)
    ring = scorer.get_ring(rings[0]["ring_id"])
    Ring(**ring)
    assert {m["id"] for m in ring["members"]} & {"C0", "C1", "M0", "M1", "OUT"}
    assert len(ring["top_reasons"]) == 5
    member = ring["members"][0]["id"]
    acc = scorer.score_account(member)
    AccountScore(**acc)
    explanation = scorer.explain(member, k=5)
    assert all(r["label"] for r in explanation)
    assert any(r["label"].startswith(("Sender:", "Receiver:")) or r["feature"] in
               ("prev_in_gap", "prev_in_ratio", "next_out_gap", "next_out_ratio", "amount_norm") or r["feature"].startswith("ch_")
               for r in explanation)


def test_payment_features_are_recomputed_for_accounts_without_kept_rows(tx_and_payment_bundle):
    tx, bundle = tx_and_payment_bundle
    scorer = Scorer.from_transactions(bundle, tx)
    kept = scorer.explain("C0", k=5)
    scorer._payment_rows = scorer._payment_rows.iloc[0:0]       # forget every kept row
    assert scorer.explain("C0", k=5) == kept                     # the same payment, recomputed on demand
    assert len(scorer._payment_rows) == 1


def test_payment_bundle_survives_save_and_load(tx_and_payment_bundle, tmp_path):
    import numpy as np
    from ml.bundle import load_bundle, save_bundle

    tx, bundle = tx_and_payment_bundle
    save_bundle(bundle, tmp_path)
    loaded = load_bundle(tmp_path)
    assert loaded.payment is not None and loaded.payment_calibration == bundle.payment_calibration
    a, b = Scorer.from_transactions(bundle, tx), Scorer.from_transactions(loaded, tx)
    assert np.allclose(a.scores.to_numpy(), b.scores.to_numpy())
