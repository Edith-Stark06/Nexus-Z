"""Account-level XGBoost: fit with class weighting, early-stop on val, score a snapshot."""
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


def score(model: XGBClassifier, snap: Snapshot, cols: list[str]) -> pd.Series:
    """Risk score (0 to 1) per account in the snapshot."""
    return pd.Series(model.predict_proba(snap.X[cols])[:, 1], index=snap.X.index, name="risk")
