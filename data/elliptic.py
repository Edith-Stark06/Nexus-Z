"""Loader for the Elliptic Bitcoin data set (CC BY-NC-ND 4.0; never commit the files).

Usage: python -m data.elliptic   (prints a profile)

Nodes are Bitcoin transactions, not accounts. 49 time steps; no edge crosses a time step.
Labels: 1 illicit, 0 licit, NaN unlabeled. Same layout as ml/elliptic.py reads directly.
"""
import numpy as np
import pandas as pd

from .paths import ELLIPTIC_DIR


def load_elliptic() -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame]:
    """Return (features with txId and step, label per row, edge list)."""
    feats = pd.read_csv(ELLIPTIC_DIR / "elliptic_txs_features.csv", header=None)
    classes = pd.read_csv(ELLIPTIC_DIR / "elliptic_txs_classes.csv")
    edges = pd.read_csv(ELLIPTIC_DIR / "elliptic_txs_edgelist.csv")
    feats.columns = ["txId", "step"] + [f"f{i}" for i in range(2, 167)]
    y = feats[["txId"]].merge(classes, on="txId", how="left")["class"].map({"1": 1, "2": 0}).to_numpy(dtype=float)
    return feats, y, edges


if __name__ == "__main__":
    f, y, e = load_elliptic()
    print(f"{len(f):,} transactions, {len(e):,} edges, {f['step'].nunique()} time steps")
    print(f"labelled illicit {int((y == 1).sum()):,}, licit {int((y == 0).sum()):,}, unlabeled {int(np.isnan(y).sum()):,}")
