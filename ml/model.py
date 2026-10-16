"""Account-level XGBoost: fit with class weighting, early-stop on val, score a snapshot."""
import numpy as np
import pandas as pd
from xgboost import XGBClassifier

from .dataset import Snapshot


def fit_model(train: Snapshot, val: Snapshot, cols: list[str], seed: int = 0) -> XGBClassifier:
    model = XGBClassifier(
        n_estimators=800, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
        scale_pos_weight=float((train.y == 0).sum() / max(train.y.sum(), 1)),
        eval_metric="aucpr", early_stopping_rounds=40, tree_method="hist", n_jobs=-1, random_state=seed,
    )
    model.fit(train.X[cols], train.y, eval_set=[(val.X[cols], val.y)], verbose=False)
    return model


def fit_calibration(model: XGBClassifier, val: Snapshot, cols: list[str]) -> tuple[float, float]:
    """Platt scaling fitted on val. Class weighting pushes raw probabilities toward 1, so
    without this many accounts and rings tie near 100%. Returns (slope, intercept) on the margin."""
    from sklearn.linear_model import LogisticRegression  # training only

    margin = model.predict(val.X[cols], output_margin=True).reshape(-1, 1)
    lr = LogisticRegression(C=1e6, max_iter=1000).fit(margin, val.y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def calibrated(margin: np.ndarray, calibration: tuple[float, float]) -> np.ndarray:
    slope, intercept = calibration
    return 1 / (1 + np.exp(-(slope * margin + intercept)))


def score(model: XGBClassifier, snap: Snapshot, cols: list[str], calibration=None) -> pd.Series:
    """Risk score (0 to 1) per account in the snapshot; calibrated if a calibration is given."""
    if calibration is None:
        values = model.predict_proba(snap.X[cols])[:, 1]
    else:
        values = calibrated(model.predict(snap.X[cols], output_margin=True), calibration)
    return pd.Series(values, index=snap.X.index, name="risk")
