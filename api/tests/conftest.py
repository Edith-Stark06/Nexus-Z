"""Shared fixtures: a small network with one planted ring and a tiny model trained to find it.

Same idea as ml/tests/conftest.py (kept separate so the API tests do not import test code from ml).
"""
import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from ml.bundle import ALL_COLS, Bundle
from ml.features import build_features

T0 = pd.Timestamp("2022-09-02 00:00")


def make_tx() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = []
    for i in range(12):  # victims pay two collectors, who forward within minutes to mules, then a cash-out
        v, c = f"V{i}", "C0" if i % 2 == 0 else "C1"
        m = "M0" if c == "C0" else "M1"
        t = T0 + pd.Timedelta(minutes=30 * i)
        rows += [(t, v, c, 500.0), (t + pd.Timedelta(minutes=4), c, m, 450.0), (t + pd.Timedelta(minutes=9), m, "OUT", 400.0)]
    for _ in range(300):  # background traffic between ordinary accounts
        a, b = rng.choice(60, 2, replace=False)
        rows.append((T0 + pd.Timedelta(minutes=int(rng.integers(0, 720))), f"B{a}", f"B{b}", float(rng.integers(20, 300))))
    tx = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount"]).sort_values("ts", ignore_index=True)
    tx["currency"] = tx["receiving_currency"] = "US Dollar"
    tx["channel"] = "ACH"
    return tx


@pytest.fixture(scope="session")
def tx_and_bundle():
    tx = make_tx()
    med = {"US Dollar": 100.0}
    X = build_features(tx, med)
    y = X.index.str.match(r"^(V|C|M|O)").astype(int)
    model = xgb.train({"objective": "binary:logistic", "max_depth": 3, "tree_method": "hist", "seed": 0},
                      xgb.DMatrix(X[ALL_COLS], label=y), num_boost_round=30)
    return tx, Bundle(model, ALL_COLS, 0.5, 0.2, med, {}, calibration=(1.0, -2.0))


def api_tx(tx_id: str, src: str, dst: str, ts: pd.Timestamp, amount: float = 500.0):
    from api.schemas import Transaction

    return Transaction(tx_id=tx_id, ts=ts.to_pydatetime(), src=src, dst=dst, amount=amount, channel="ACH")
