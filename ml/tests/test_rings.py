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


def test_growing_rings_gathers_weaker_members_but_needs_a_strong_seed():
    # strong a, b; middling c, d linked to them; weak e hanging off d; x and y are a middling pair with no strong seed
    scores = pd.Series({"a": 0.95, "b": 0.94, "c": 0.5, "d": 0.45, "e": 0.05, "x": 0.4, "y": 0.35, "f": 0.01, "g": 0.01, "h": 0.01})
    tx = pd.DataFrame({"src": ["a", "b", "c", "d", "x", "f"], "dst": ["b", "c", "d", "e", "y", "g"]})
    strict_only = detect_rings(scores, tx, top_fraction=0.2, min_size=3)               # just a and b: too small for a ring
    grown = detect_rings(scores, tx, top_fraction=0.2, min_size=3, grow_fraction=0.5)   # the top 5 of 10 accounts
    assert strict_only == []
    assert len(grown) == 1 and grown[0].members == ["a", "b", "c", "d"]
    assert "x" not in grown[0].members                                                 # x and y have no strong seed
    wider = detect_rings(scores, tx, top_fraction=0.2, min_size=3, grow_fraction=0.7)  # now weak e is inside the net
    assert [r.members for r in wider] == [["a", "b", "c", "d", "e"]]


def test_not_growing_is_unchanged():
    scores, tx = sample()
    assert [r.members for r in detect_rings(scores, tx, top_fraction=0.84, min_size=3, grow_fraction=None)] == [["a", "b", "c"]]
