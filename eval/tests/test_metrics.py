import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve

from eval.metrics import (active_rings, average_precision, best_f1_threshold, hub_rings, precision_recall_f1,
                          ring_purity, ring_recovery, time_to_detection)


def test_average_precision_matches_scikit_learn_including_ties():
    rng = np.random.default_rng(0)
    for _ in range(20):
        y = rng.random(400) < 0.1
        s = np.round(rng.random(400) + 0.6 * y, 1)  # rounding creates many tied scores
        assert abs(average_precision(y, s) - average_precision_score(y, s)) < 1e-12


def test_average_precision_edge_cases():
    assert average_precision([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1]) == 1.0
    assert np.isnan(average_precision([0, 0], [0.1, 0.2]))


def test_best_f1_threshold_matches_the_curve():
    rng = np.random.default_rng(1)
    y = rng.random(500) < 0.2
    s = rng.random(500) + 0.7 * y
    prec, rec, thr = precision_recall_curve(y, s)
    f1 = 2 * prec[:-1] * rec[:-1] / np.maximum(prec[:-1] + rec[:-1], 1e-12)
    mine = precision_recall_f1(y, s, best_f1_threshold(y, s))["f1"]
    assert abs(mine - f1.max()) < 1e-12


def test_precision_recall_f1_counts():
    r = precision_recall_f1([1, 1, 0, 0, 1], [0.9, 0.2, 0.8, 0.1, 0.7], 0.5)
    assert (r["flagged"], r["positives"]) == (3, 3)
    assert abs(r["precision"] - 2 / 3) < 1e-12 and abs(r["recall"] - 2 / 3) < 1e-12


def truth(pid, accounts, first, last):
    return {"pattern_id": pid, "accounts": set(accounts), "first_ts": pd.Timestamp(first), "last_ts": pd.Timestamp(last)}


def test_ring_recovery_needs_half_of_the_accounts_in_one_detected_ring():
    rings = [truth(0, "abcd", "2022-01-02", "2022-01-03"), truth(1, "efgh", "2022-01-02", "2022-01-03")]
    detected = [{"a", "b", "z"}, {"e", "x"}, {"f", "y"}]  # ring 0: half in one detected ring; ring 1: split 1+1
    out = ring_recovery(detected, rings)
    assert out["recovery"] == 0.5 and out["true_rings"] == 2
    assert ring_recovery([], rings)["recovery"] == 0.0


def test_purity_hub_rings_and_activity_window():
    assert list(ring_purity([{"a", "b"}, {"c", "d"}], {"a", "b", "c"})) == [1.0, 0.5]
    assert hub_rings([{"h1", "h2", "x"}, {"a", "b"}], {"h1", "h2"}) == 1
    rings = [truth(0, "ab", "2022-01-02", "2022-01-03"), truth(1, "cd", "2022-01-09", "2022-01-10")]
    window = (pd.Timestamp("2022-01-01"), pd.Timestamp("2022-01-05"))
    assert [r["pattern_id"] for r in active_rings(rings, window)] == [0]


def test_time_to_detection():
    rings = [truth(0, "ab", "2022-01-02 00:00", "2022-01-02 20:00"), truth(1, "cd", "2022-01-02 00:00", "2022-01-02 02:00"),
             truth(2, "ef", "2022-01-02 00:00", "2022-01-02 02:00")]
    got = time_to_detection({0: pd.Timestamp("2022-01-02 06:00"), 1: pd.Timestamp("2022-01-02 12:00")}, rings)
    assert got["detected"] == 2 and abs(got["detected_share"] - 2 / 3) < 1e-12
    assert got["median_hours"] == 9.0 and abs(got["caught_before_last_payment"] - 1 / 3) < 1e-12
