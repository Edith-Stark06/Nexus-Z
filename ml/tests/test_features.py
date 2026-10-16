import numpy as np
import pandas as pd

from ml.features import FAST_MINUTES, build_features


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
