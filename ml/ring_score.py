"""A learned ring score: the chance that a detected ring is a real one.

The first ring score was the mean of the three highest member scores. It ranked real and
non-real rings barely better than chance, so this fits a small logistic regression on ring
descriptors (size, density, concentration, member score spread) using val rings, where a ring is
"real" if at least half its members touch laundering. Parameters are saved as plain numbers,
so serving needs only numpy.
"""
from dataclasses import replace

import numpy as np

from .rings import Ring

FEATURES = ["log_size", "density", "concentration", "log_tx_per_member",
            "mean_score", "min_score", "max_score", "top3_score"]
PURE_AT = 0.5  # share of members that must touch laundering for a ring to count as real
MIN_SHARE = 0.15  # fit only when at least this share of the training rings are real, and at least this share are not


def vector(r: Ring) -> list[float]:
    return [np.log(r.size), r.density, r.concentration, np.log1p(r.n_tx / max(r.size, 1)),
            r.mean_score, r.min_score, r.max_score, r.top3_score]


def purity(rings: list[Ring], positives: set) -> np.ndarray:
    return np.array([np.mean([a in positives for a in r.members]) for r in rings]) if rings else np.array([])


def fit(rings: list[Ring], is_real: np.ndarray) -> dict | None:
    """Fit on rings with known outcomes. Returns None when there is nothing to learn from."""
    from sklearn.linear_model import LogisticRegression  # training only

    share = float(np.mean(is_real)) if len(is_real) else 0.0
    # With almost no negatives (or almost no positives) there is nothing to learn and the fitted score saturates,
    # so every ring would show the same top risk. Keep the plain top-account score instead.
    if len(rings) < 30 or not MIN_SHARE <= share <= 1 - MIN_SHARE:
        return None
    X = np.array([vector(r) for r in rings])
    mean, scale = X.mean(axis=0), X.std(axis=0) + 1e-9
    lr = LogisticRegression(C=1.0, max_iter=2000).fit((X - mean) / scale, is_real.astype(int))
    return {"features": FEATURES, "mean": mean.tolist(), "scale": scale.tolist(),
            "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0])}


def probabilities(rings: list[Ring], params: dict) -> np.ndarray:
    if not rings:
        return np.array([])
    z = (np.array([vector(r) for r in rings]) - params["mean"]) / params["scale"]
    return 1 / (1 + np.exp(-(z @ np.array(params["coef"]) + params["intercept"])))


def apply(rings: list[Ring], params: dict | None) -> list[Ring]:
    """Replace each ring's risk with the learned probability and sort, highest first."""
    if params is None:
        return rings
    probs = probabilities(rings, params)
    return sorted((replace(r, risk=float(p)) for r, p in zip(rings, probs)), key=lambda x: x.risk, reverse=True)
