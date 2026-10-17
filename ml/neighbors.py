"""Neighbor summaries of account scores. No scikit-learn here, so the serving path can import it.

Used by the two-stage model (training in ml/stack.py, serving in ml/service.py).
"""
import numpy as np
import pandas as pd
from scipy import sparse

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


def stage2_inputs(X_active: pd.DataFrame, cols: list[str], all_index: pd.Index, scores_all: np.ndarray, edges: tuple,
                  high_quantile: float = 0.99) -> pd.DataFrame:
    """Stage-2 inputs for the active accounts: their own features plus summaries of stage-1 scores around them."""
    nb = neighbor_features(scores_all, edges, high_quantile)
    nb.index = all_index
    return pd.concat([X_active[cols], nb.loc[X_active.index]], axis=1)
