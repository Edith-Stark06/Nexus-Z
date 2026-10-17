import numpy as np
import pandas as pd
from scipy import sparse

from ml.features import FAST_MINUTES, _core_numbers, _structure, build_features


def tiny_chain():
    t0 = pd.Timestamp("2022-09-01 00:00")
    rows = [  # A pays B, B forwards to C after 5 minutes, C forwards to D after 295 more
        (t0, "A", "B", 100.0), (t0 + pd.Timedelta(minutes=5), "B", "C", 100.0),
        (t0 + pd.Timedelta(minutes=300), "C", "D", 100.0),
        (t0 + pd.Timedelta(minutes=301), "E", "C", 50.0),
    ]
    tx = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount"])
    tx["currency"] = "US Dollar"
    tx["receiving_currency"] = "US Dollar"
    tx["channel"] = "ACH"
    return tx


def test_pass_through_and_degrees():
    f = build_features(tiny_chain(), {"US Dollar": 100.0})
    assert f.loc["B", "pt_min"] == 5 and f.loc["B", "fast_out_share"] == 1.0
    assert f.loc["C", "pt_min"] == 295 and f.loc["C", "fast_out_share"] == 0.0
    assert f.loc["A", "no_prior_in_share"] == 1.0 and np.isnan(f.loc["A", "pt_min"])
    assert f.loc["C", "n_in_cp"] == 2 and f.loc["C", "n_out_cp"] == 1
    assert f.loc["C", "fan_in_ratio"] == 2 / 2
    assert FAST_MINUTES == 15


def small_graph():
    """Triangle 0-1-2, a tail node 3 hanging off 0, an isolated node 4, and a separate pair 5-6."""
    edges = [(0, 1), (1, 2), (0, 2), (0, 3), (5, 6)]
    r, c = zip(*edges)
    S = sparse.csr_matrix((np.ones(len(edges)), (r, c)), shape=(7, 7))
    return ((S + S.T) > 0).astype(float).tocsr()


def test_core_numbers():
    assert _core_numbers(small_graph()).tolist() == [2, 2, 2, 1, 0, 1, 1]


def test_clustering_and_components():
    clustering, size, avg_deg = _structure(small_graph(), cap=100)
    assert np.allclose(clustering[:4], [1 / 3, 1.0, 1.0, 0.0])
    assert size.tolist() == [4, 4, 4, 4, 1, 2, 2]
    assert np.isclose(avg_deg[0], 2 * 4 / 4) and avg_deg[5] == 1.0


def test_hubs_are_left_out_of_structure_counts():
    clustering, size, _ = _structure(small_graph(), cap=2)  # node 0 has 3 neighbors, so it is a hub
    assert np.isnan(clustering[0]) and np.isnan(size[0])
    assert size[1] == 2 and size[3] == 1  # triangle broken without node 0


def test_amounts_are_normalized_by_currency_median():
    f = build_features(tiny_chain(), {"US Dollar": 100.0})
    assert f.loc["A", "out_sum"] == 1.0 and f.loc["E", "out_sum"] == 0.5


def test_features_ignore_transactions_not_passed_in():
    """Dropping later rows must not change an account's earlier features (no hidden look-ahead)."""
    tx = tiny_chain()
    early = build_features(tx.iloc[:2], {"US Dollar": 100.0})
    full = build_features(tx, {"US Dollar": 100.0})
    assert early.loc["B", "pt_min"] == full.loc["B", "pt_min"] == 5
    assert "D" not in early.index and "D" in full.index


def test_burst_cycle_loop_and_duplicate_amount_features():
    from ml.features import MOTIF_COLS

    t0 = pd.Timestamp("2022-09-01 00:00")
    rows = []
    for i, minute in enumerate((0, 10, 20)):                 # three payers inside one hour
        rows.append((t0 + pd.Timedelta(minutes=minute), f"P{i}", "HUB", 50.0))
    rows.append((t0 + pd.Timedelta(hours=10), "P3", "HUB", 50.0))   # a fourth, ten hours later
    rows += [(t0 + pd.Timedelta(minutes=1), "X", "Y", 10.0), (t0 + pd.Timedelta(minutes=2), "Y", "Z", 11.0),
             (t0 + pd.Timedelta(minutes=3), "Z", "X", 12.0)]         # a directed 3-cycle
    rows += [(t0 + pd.Timedelta(minutes=4), "A", "B", 5.0), (t0 + pd.Timedelta(minutes=5), "B", "C", 6.0),
             (t0 + pd.Timedelta(minutes=6), "A", "C", 7.0)]          # a feed-forward loop A->B->C and A->C
    rows += [(t0 + pd.Timedelta(minutes=7), "S", "R1", 99.0), (t0 + pd.Timedelta(minutes=8), "S", "R2", 99.0),
             (t0 + pd.Timedelta(minutes=9), "S", "R3", 12.5)]        # S repeats an amount twice out of three
    tx = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount"])
    tx["currency"] = tx["receiving_currency"] = "US Dollar"
    tx["channel"] = "ACH"
    f = build_features(tx, {"US Dollar": 100.0})
    assert all(c in f.columns for c in MOTIF_COLS)
    assert (f.loc["HUB", "fanin_1h"], f.loc["HUB", "fanin_6h"], f.loc["HUB", "fanin_24h"]) == (3, 3, 4)
    assert f.loc["P0", "fanout_1h"] == 1
    assert f.loc[["X", "Y", "Z"], "cyc3"].tolist() == [1, 1, 1] and f.loc["A", "cyc3"] == 0
    assert f.loc["A", "ffl"] == 1 and f.loc["B", "ffl"] == 0
    assert f.loc["S", "dup_amount_share"] == 2 / 3 and f.loc["A", "dup_amount_share"] == 0
