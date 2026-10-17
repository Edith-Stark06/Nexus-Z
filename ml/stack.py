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
from scipy import sparse
from sklearn.model_selection import StratifiedKFold
from xgboost import XGBClassifier

from .dataset import Snapshot
from .model import fit_calibration, fit_model

NEIGHBOR_COLS = ["s1", "nb_in_mean", "nb_in_max", "nb_out_mean", "nb_out_max", "nb_in_high", "nb_out_high",
                 "nb_in_high_share", "nb_out_high_share", "nb_in_mean2", "nb_out_mean2"]


def _row_max(M: sparse.csr_matrix, values: np.ndarray) -> np.ndarray:
    """Largest value among each row's columns (0 for rows with no entries)."""
    out = np.zeros(M.shape[0])
    filled = np.diff(M.indptr) > 0
    if M.nnz:
        out[filled] = np.maximum.reduceat(values[M.indices], M.indptr[:-1][filled])
    return out


def neighbor_features(scores: np.ndarray, edges: tuple, high_quantile: float = 0.99) -> pd.DataFrame:
    """Summaries of `scores` over each account's payers (in) and payees (out). `edges` are row positions."""
    n = len(scores)
    payer, payee = edges
    pays = sparse.csr_matrix((np.ones(len(payer)), (payer, payee)), shape=(n, n))  # row pays column
    paid_by = pays.T.tocsr()                                                       # row is paid by column
    n_out, n_in = np.asarray(pays.sum(axis=1)).ravel(), np.asarray(pays.sum(axis=0)).ravel()
    out_div, in_div = np.maximum(n_out, 1), np.maximum(n_in, 1)
    high = (scores > np.quantile(scores, high_quantile)).astype(float)

    f = {"s1": scores,
         "nb_in_mean": (paid_by @ scores) / in_div, "nb_in_max": _row_max(paid_by, scores),
         "nb_out_mean": (pays @ scores) / out_div, "nb_out_max": _row_max(pays, scores),
         "nb_in_high": paid_by @ high, "nb_out_high": pays @ high}
    f["nb_in_high_share"], f["nb_out_high_share"] = f["nb_in_high"] / in_div, f["nb_out_high"] / out_div
    f["nb_in_mean2"] = (paid_by @ f["nb_in_mean"]) / in_div
    f["nb_out_mean2"] = (pays @ f["nb_out_mean"]) / out_div
    return pd.DataFrame({c: f[c] for c in NEIGHBOR_COLS})


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
        nb = neighbor_features(scores_all, snap.edges, self.high_quantile)
        nb.index = snap.all_X.index
        return pd.concat([snap.X[self.cols], nb.loc[snap.X.index]], axis=1)

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
