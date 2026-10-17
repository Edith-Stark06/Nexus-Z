import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from ml.bundle import ALL_COLS, Bundle
from ml.features import build_features


def make_tx():
    rng = np.random.default_rng(0)
    t0 = pd.Timestamp("2022-09-02 00:00")
    rows = []
    victims = [f"V{i}" for i in range(12)]
    for i, v in enumerate(victims):  # victims pay two collectors, who forward within minutes to mules, then one cash-out
        c = "C0" if i % 2 == 0 else "C1"
        t = t0 + pd.Timedelta(minutes=30 * i)
        rows += [(t, v, c, 500.0), (t + pd.Timedelta(minutes=4), c, "M0" if c == "C0" else "M1", 450.0),
                 (t + pd.Timedelta(minutes=9), "M0" if c == "C0" else "M1", "OUT", 400.0)]
    for _ in range(300):  # background traffic between ordinary accounts
        a, b = rng.choice(60, 2, replace=False)
        rows.append((t0 + pd.Timedelta(minutes=int(rng.integers(0, 720))), f"B{a}", f"B{b}", float(rng.integers(20, 300))))
    tx = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount"]).sort_values("ts", ignore_index=True)
    tx["currency"] = tx["receiving_currency"] = "US Dollar"
    tx["channel"] = "ACH"
    return tx


@pytest.fixture(scope="module")
def tx_and_bundle():
    """A small network with one planted ring, and a tiny model trained to find it."""
    tx = make_tx()
    med = {"US Dollar": 100.0}
    X = build_features(tx, med)
    y = X.index.str.match(r"^(V|C|M|O)").astype(int)
    model = xgb.train({"objective": "binary:logistic", "max_depth": 3, "tree_method": "hist", "seed": 0},
                      xgb.DMatrix(X[ALL_COLS], label=y), num_boost_round=30)
    return tx, Bundle(model, ALL_COLS, 0.5, 0.2, med, {}, calibration=(1.0, -2.0))


@pytest.fixture(scope="module")
def tx_and_two_stage_bundle():
    """The same small network, with a tiny two-stage model: stage 2 also sees summaries of neighbors' stage-1 scores."""
    from ml.features import build_features_with_edges
    from ml.neighbors import NEIGHBOR_COLS, stage2_inputs

    tx = make_tx()
    med = {"US Dollar": 100.0}
    X, edges = build_features_with_edges(tx, med)
    y = X.index.str.match(r"^(V|C|M|O)").astype(int)
    params = {"objective": "binary:logistic", "max_depth": 3, "tree_method": "hist", "seed": 0}
    stage1 = xgb.train(params, xgb.DMatrix(X[ALL_COLS], label=y), num_boost_round=30)
    X2 = stage2_inputs(X, ALL_COLS, X.index, stage1.predict(xgb.DMatrix(X[ALL_COLS])), edges, 0.9)
    stage2 = xgb.train(params, xgb.DMatrix(X2[ALL_COLS + NEIGHBOR_COLS], label=y), num_boost_round=30)
    return tx, Bundle(stage1, ALL_COLS, 0.5, 0.2, med, {}, calibration=(1.0, -2.0), stage2=stage2, high_quantile=0.9)
