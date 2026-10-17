"""Two-stage model: score every account, then score each account again with its neighbors' scores.

A fraud ring is a neighborhood, so an account whose payers and payees all look risky is more
suspicious than its own features say. Stage 1 is the ordinary account model. Stage 2 adds, for
each account, summaries of stage-1 scores of the accounts that pay it and that it pays (mean, max,
share of high-risk neighbors, and one more hop). This is message passing done with boosted trees.

To keep stage 2 honest it is trained on out-of-fold stage-1 scores: an account's own stage-1 score
and its neighbors' scores never come from a model that saw that account's label.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from xgboost import XGBClassifier

from .dataset import Snapshot
from .model import fit_calibration, fit_model

from .neighbors import NEIGHBOR_COLS, _row_max, neighbor_features, stage2_inputs  # noqa: F401  (re-exported)


@dataclass
class Stacked:
    stage1: XGBClassifier
    stage2: XGBClassifier
    cols: list[str]
    calibration: tuple
    high_quantile: float = 0.99

    @property
    def cols2(self) -> list[str]:
        return self.cols + NEIGHBOR_COLS

    def stage2_frame(self, snap: Snapshot, scores_all: np.ndarray | None = None) -> pd.DataFrame:
        """Stage-2 inputs for the active accounts of a snapshot, using stage-1 scores from the full model."""
        if scores_all is None:
            scores_all = self.stage1.predict_proba(snap.all_X[self.cols])[:, 1]
        return stage2_inputs(snap.X, self.cols, snap.all_X.index, scores_all, snap.edges, self.high_quantile)

    def score(self, snap: Snapshot) -> pd.Series:
        """Calibrated stage-2 risk for the active accounts of a snapshot."""
        from .model import calibrated

        X2 = self.stage2_frame(snap)
        margin = self.stage2.predict(X2[self.cols2], output_margin=True)
        return pd.Series(calibrated(margin, self.calibration), index=X2.index, name="risk")


def fit_stacked(train: Snapshot, val: Snapshot, cols: list[str], folds: int = 5, seed: int = 0,
                high_quantile: float = 0.99) -> Stacked:
    stage1 = fit_model(train, val, cols, seed)

    # out-of-fold stage-1 scores for the training accounts; accounts that are not training rows are
    # never seen by any stage-1 model, so the full model scores them without leakage
    scores_train = stage1.predict_proba(train.all_X[cols])[:, 1]
    at = train.all_X.index.get_indexer(train.X.index)
    oof = np.zeros(len(train.X))
    for fit_idx, hold_idx in StratifiedKFold(folds, shuffle=True, random_state=seed).split(train.X, train.y):
        part = Snapshot(X=train.X.iloc[fit_idx], y=train.y.iloc[fit_idx], seen_positive=train.seen_positive.iloc[fit_idx],
                        cutoff=train.cutoff)
        oof[hold_idx] = fit_model(part, val, cols, seed).predict_proba(train.X[cols].iloc[hold_idx])[:, 1]
    scores_train[at] = oof

    shell = Stacked(stage1, None, cols, (1.0, 0.0), high_quantile)
    X2_train = shell.stage2_frame(train, scores_train)
    X2_val = shell.stage2_frame(val)
    stage2 = fit_model(Snapshot(X2_train, train.y, train.seen_positive, train.cutoff),
                       Snapshot(X2_val, val.y, val.seen_positive, val.cutoff), shell.cols2, seed)
    calibration = fit_calibration(stage2, Snapshot(X2_val, val.y, val.seen_positive, val.cutoff), shell.cols2)
    return Stacked(stage1, stage2, cols, calibration, high_quantile)
