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
    pytest.importorskip("sklearn")  # ring scoring metric needs scikit-learn, which is an evaluation-only dependency
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


def clique_edges(names):
    return [(a, b) for i, a in enumerate(names) for b in names[i + 1:]]


def test_oversized_group_is_split_into_rings_within_the_size_limit():
    left, right = list("abcde"), list("vwxyz")
    pairs = clique_edges(left) + clique_edges(right) + [("e", "v")]  # two tight groups joined by one payment
    tx = pd.DataFrame(pairs, columns=["src", "dst"])
    scores = pd.Series(0.9, index=left + right)
    rings = detect_rings(scores, tx, top_fraction=1.0, min_size=3, max_size=6)
    assert sorted(r.size for r in rings) == [5, 5]
    assert {frozenset(r.members) for r in rings} == {frozenset(left), frozenset(right)}
