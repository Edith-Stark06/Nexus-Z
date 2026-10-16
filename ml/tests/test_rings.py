import pandas as pd
import pytest

from ml.ring_eval import evaluate
from ml.rings import detect_rings


def sample():
    scores = pd.Series({"a": 0.9, "b": 0.8, "c": 0.7, "d": 0.95, "e": 0.9, "f": 0.1})
    tx = pd.DataFrame({"src": ["a", "b", "d", "f"], "dst": ["b", "c", "e", "a"]})
    return scores, tx


def test_connected_group_becomes_one_ring_and_pairs_are_dropped():
    scores, tx = sample()
    rings = detect_rings(scores, tx, top_fraction=0.84, min_size=3)
    assert len(rings) == 1  # d-e is only two accounts, and f is below the score cutoff
    ring = rings[0]
    assert ring.members == ["a", "b", "c"]
    assert ring.risk == pytest.approx(0.8)
    assert ring.density == pytest.approx(2 / 3)
    assert ring.concentration == pytest.approx(0.5)
    assert ring.n_tx == 2


def test_recovery_and_purity():
    scores, tx = sample()
    rings = detect_rings(scores, tx, top_fraction=0.84, min_size=3)
    ts = pd.Timestamp("2022-09-02")
    patterns = [
        {"first_ts": ts, "last_ts": ts, "accounts": {"a", "b", "x", "y"}},  # half found: recovered
        {"first_ts": ts, "last_ts": ts, "accounts": {"c", "x", "y", "z"}},  # a quarter found: missed
        {"first_ts": pd.Timestamp("2022-08-01"), "last_ts": pd.Timestamp("2022-08-01"), "accounts": {"a", "b"}},  # outside window
    ]
    m = evaluate(rings, patterns, positives={"a", "b"}, window=(pd.Timestamp("2022-09-01"), pd.Timestamp("2022-09-03")))
    assert m["true_rings"] == 2 and m["recovery"] == pytest.approx(0.5)
    assert m["mean_purity"] == pytest.approx(2 / 3) and m["pure_rings"] == 1.0
