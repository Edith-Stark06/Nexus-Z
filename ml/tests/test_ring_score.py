import numpy as np
import pytest

from ml.ring_score import apply, fit, probabilities, purity
from ml.rings import Ring


def make_rings(n, seed):
    rng = np.random.default_rng(seed)
    rings, real = [], []
    for i in range(n):
        is_real = i % 2 == 0
        base = 0.7 if is_real else 0.3  # real rings have higher, tighter member scores
        top = float(np.clip(base + rng.normal(0, 0.05), 0, 1))
        rings.append(Ring(members=[f"r{i}a", f"r{i}b", f"r{i}c"], risk=top, size=int(rng.integers(3, 12)),
                          density=float(rng.uniform(0.2, 0.9)), concentration=float(rng.uniform(0.1, 0.9)),
                          n_tx=int(rng.integers(3, 40)), mean_score=top - 0.05, min_score=top - 0.1,
                          max_score=top + 0.02, top3_score=top))
        real.append(is_real)
    return rings, np.array(real)


def test_scorer_learns_to_rank_real_rings_above_others_and_generalizes():
    train, y_train = make_rings(120, seed=0)
    test, y_test = make_rings(80, seed=1)
    params = fit(train, y_train)
    p = probabilities(test, params)
    assert p[y_test].mean() > 0.8 and p[~y_test].mean() < 0.2
    ranked = apply(test, params)
    assert [r.risk for r in ranked] == sorted((r.risk for r in ranked), reverse=True)
    assert all(0 <= r.risk <= 1 for r in ranked)


def test_scorer_needs_both_outcomes_and_enough_rings():
    rings, real = make_rings(10, seed=0)
    assert fit(rings, real) is None                    # too few rings
    rings, _ = make_rings(60, seed=0)
    assert fit(rings, np.ones(60, bool)) is None       # nothing to contrast
    assert apply(rings, None) is rings                 # no scorer: ring risk unchanged


def test_purity():
    rings, _ = make_rings(2, seed=0)
    assert purity(rings, {"r0a", "r0b", "r1a"}).tolist() == pytest.approx([2 / 3, 1 / 3])
