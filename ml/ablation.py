"""Train XGBoost on three feature sets and compare them on the test window.

Usage (from the repo root):  python -m ml.ablation HI-Small
"""
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve
from xgboost import XGBClassifier

from .dataset import make_snapshots
from .features import BEHAVIOR_COLS, GRAPH_COLS, MOTIF_COLS, STRUCTURE_COLS, TX_COLS

FEATURE_SETS = {
    "transaction-only": TX_COLS,
    "+ behavioral": TX_COLS + BEHAVIOR_COLS,
    "+ graph": TX_COLS + BEHAVIOR_COLS + GRAPH_COLS,
    "+ k-core, clustering, components": TX_COLS + BEHAVIOR_COLS + GRAPH_COLS + STRUCTURE_COLS,
    "+ bursts and motifs": TX_COLS + BEHAVIOR_COLS + GRAPH_COLS + STRUCTURE_COLS + MOTIF_COLS,
}


def best_f1_threshold(y, p) -> float:
    prec, rec, thr = precision_recall_curve(y, p)
    f1 = 2 * prec[:-1] * rec[:-1] / np.maximum(prec[:-1] + rec[:-1], 1e-12)
    return float(thr[f1.argmax()])


def report(y, p, thr) -> dict:
    pred = p >= thr
    tp = int((pred & (y == 1)).sum())
    precision = tp / max(int(pred.sum()), 1)
    recall = tp / max(int((y == 1).sum()), 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-12)
    return {"positives": int(y.sum()), "pr_auc": average_precision_score(y, p),
            "precision": precision, "recall": recall, "f1": f1}


def run(variant: str) -> pd.DataFrame:
    snaps = make_snapshots(variant)
    tr, va, te = snaps["train"], snaps["val"], snaps["test"]
    new_only = ~te.seen_positive.to_numpy()
    print(f"train {len(tr.X):,} accounts ({int(tr.y.sum())} positive), val {len(va.X):,} ({int(va.y.sum())}), "
          f"test {len(te.X):,} ({int(te.y.sum())}; {int(te.y[new_only].sum())} are new accounts)")

    rows = []
    for name, cols in FEATURE_SETS.items():
        model = XGBClassifier(
            n_estimators=800, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
            scale_pos_weight=float((tr.y == 0).sum() / max(tr.y.sum(), 1)),
            eval_metric="aucpr", early_stopping_rounds=40, tree_method="hist", n_jobs=-1, random_state=0,
        )
        model.fit(tr.X[cols], tr.y, eval_set=[(va.X[cols], va.y)], verbose=False)
        thr = best_f1_threshold(va.y, model.predict_proba(va.X[cols])[:, 1])
        p = model.predict_proba(te.X[cols])[:, 1]
        for scope, mask in (("all accounts", np.ones(len(te.X), bool)), ("new accounts only", new_only)):
            rows.append({"features": name, "scope": scope, "trees": model.best_iteration + 1,
                         **report(te.y.to_numpy()[mask], p[mask], thr)})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    result = run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print(result.to_string(index=False))
