import numpy as np
import pandas as pd
import pytest

from ml.edge_model import TX_FEATURES, account_scores, flow_features, payment_features
from ml.features import build_features


def chain():
    t0 = pd.Timestamp("2022-09-01 00:00")
    rows = [(t0, "A", "B", 100.0), (t0 + pd.Timedelta(minutes=5), "B", "C", 90.0),
            (t0 + pd.Timedelta(minutes=300), "C", "D", 80.0)]
    tx = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount"])
    tx["currency"] = tx["receiving_currency"] = "US Dollar"
    tx["channel"] = "ACH"
    return tx


MED = {"US Dollar": 100.0}


def test_money_passing_through_is_visible_per_payment():
    tx = chain()
    f = flow_features(tx, tx, build_features(tx, MED).index, MED)
    # row 1 is B -> C: B received 100 five minutes earlier, and now sends 90
    assert f.loc[1, "prev_in_gap"] == 5 and f.loc[1, "prev_in_ratio"] == pytest.approx(0.9)
    # row 0 is A -> B: B passes money on after five minutes, sending 90 of the 100
    assert f.loc[0, "next_out_gap"] == 5 and f.loc[0, "next_out_ratio"] == pytest.approx(0.9)
    assert np.isnan(f.loc[0, "prev_in_gap"])           # A never received anything
    assert np.isnan(f.loc[2, "next_out_gap"])          # D never sends again


def test_flow_features_only_look_at_history_given():
    tx = chain()
    idx = build_features(tx, MED).index
    early = flow_features(tx.iloc[:2], tx.iloc[:2], idx, MED)
    assert np.isnan(early.loc[1, "next_out_gap"])      # C's later payment is not in the history passed in


def test_payment_rows_have_payment_flow_and_endpoint_columns():
    tx = chain()
    X = build_features(tx, MED)
    cols = ["out_cnt", "in_cnt"]
    rows = payment_features(tx, tx, X, cols, MED)
    assert len(rows) == len(tx) and rows.dtypes.eq("float32").all()
    assert set(TX_FEATURES) <= set(rows.columns)
    assert {"s_out_cnt", "d_in_cnt"} <= set(rows.columns)
    assert rows.loc[1, "s_out_cnt"] == 1 and rows.loc[1, "d_in_cnt"] == 1     # B sent once; C received once


def test_account_takes_its_riskiest_payment():
    tx = chain()
    s = account_scores(tx, np.array([0.2, 0.9, 0.1]))
    assert s["B"] == pytest.approx(0.9) and s["C"] == pytest.approx(0.9) and s["A"] == pytest.approx(0.2)
    assert s["D"] == pytest.approx(0.1)
