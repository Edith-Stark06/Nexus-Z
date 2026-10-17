"""Evaluation metrics, written here so the results do not depend on the modelling side's own scoring code.

Account level: average precision (PR-AUC), precision, recall and F1 at a threshold.
Ring level: recovery, purity, time to detection. Look-alike hubs: false-positive rate.
Everything takes plain arrays and sets, so it can be tested without any model.
"""
from collections import Counter

import numpy as np


def average_precision(y, s) -> float:
    """Area under the precision-recall curve as a step sum (the same definition scikit-learn uses)."""
    y, s = np.asarray(y).astype(bool), np.asarray(s, dtype=float)
    if y.sum() == 0:
        return float("nan")
    order = np.argsort(-s, kind="mergesort")
    y, s = y[order], s[order]
    last = np.r_[np.flatnonzero(np.diff(s)), len(s) - 1]  # one point per distinct score, so ties are not ordered arbitrarily
    tp = np.cumsum(y)[last]
    precision, recall = tp / (last + 1), tp / y.sum()
    return float(np.sum(np.diff(np.r_[0.0, recall]) * precision))


def best_f1_threshold(y, s) -> float:
    """Score threshold that maximises F1 (flag when score >= threshold). Choose it on validation data."""
    y, s = np.asarray(y).astype(bool), np.asarray(s, dtype=float)
    order = np.argsort(-s, kind="mergesort")
    y, s = y[order], s[order]
    last = np.r_[np.flatnonzero(np.diff(s)), len(s) - 1]
    tp = np.cumsum(y)[last]
    precision, recall = tp / (last + 1), tp / max(y.sum(), 1)
    f1 = 2 * precision * recall / np.maximum(precision + recall, 1e-12)
    return float(s[last][int(f1.argmax())])


def precision_recall_f1(y, s, threshold: float) -> dict:
    y, flagged = np.asarray(y).astype(bool), np.asarray(s, dtype=float) >= threshold
    tp = int((flagged & y).sum())
    precision = tp / max(int(flagged.sum()), 1)
    recall = tp / max(int(y.sum()), 1)
    return {"precision": precision, "recall": recall, "f1": 2 * precision * recall / max(precision + recall, 1e-12),
            "flagged": int(flagged.sum()), "positives": int(y.sum())}


def active_rings(rings: list[dict], window: tuple, min_accounts: int = 2) -> list[dict]:
    """Ground-truth rings with a laundering payment inside (lo, hi]."""
    lo, hi = window
    return [r for r in rings if r["first_ts"] is not None and r["last_ts"] > lo and r["first_ts"] <= hi
            and len(r["accounts"]) >= min_accounts]


def ring_recovery(detected: list, truth: list[dict], cover: float = 0.5) -> dict:
    """A true ring is recovered if one detected ring holds at least `cover` of its fraud accounts.

    `detected` is a list of collections of account ids (one per detected ring).
    """
    owner = {}
    for i, members in enumerate(detected):
        for a in members:
            owner[a] = i
    covers = []
    for r in truth:
        counts = Counter(owner[a] for a in r["accounts"] if a in owner)
        covers.append(max(counts.values()) / len(r["accounts"]) if counts else 0.0)
    covers = np.array(covers)
    return {"true_rings": len(truth), "recovery": float((covers >= cover).mean()) if len(covers) else float("nan"),
            "mean_cover": float(covers.mean()) if len(covers) else float("nan")}


def ring_purity(detected: list, positives: set) -> np.ndarray:
    """Per detected ring: the share of its members that are truly positive."""
    return np.array([np.mean([a in positives for a in members]) for members in detected]) if detected else np.array([])


def hub_rings(detected: list, hubs: set, share: float = 0.5) -> int:
    """Detected rings made mostly of legitimate hub accounts: a false alarm of the worst kind."""
    return sum(np.mean([a in hubs for a in members]) >= share for members in detected)


def time_to_detection(detected_at: dict, rings: list[dict]) -> dict:
    """Hours from a ring's first laundering payment to the replay step that detected it."""
    hours = np.array([(detected_at[r["pattern_id"]] - r["first_ts"]).total_seconds() / 3600
                      for r in rings if r["pattern_id"] in detected_at])
    early = sum(detected_at[r["pattern_id"]] < r["last_ts"] for r in rings if r["pattern_id"] in detected_at)
    return {"rings": len(rings), "detected": len(hours), "detected_share": len(hours) / max(len(rings), 1),
            "median_hours": float(np.median(hours)) if len(hours) else float("nan"),
            "p90_hours": float(np.percentile(hours, 90)) if len(hours) else float("nan"),
            "caught_before_last_payment": early / max(len(rings), 1)}
