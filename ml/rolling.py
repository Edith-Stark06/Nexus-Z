"""Rolling-window protocol: features from a fixed span of recent history, so rebuild cost stays bounded.

Usage (from the repo root):  python -m ml.rolling HI-Small

The cumulative protocol (PROTOCOL.md) rebuilds features from all history, so scoring gets slower as
data grows. Here each snapshot at time t uses only transactions in (t - HISTORY_HOURS, t], scores
the accounts active in the last ACTIVE_HOURS, and labels an account positive if it is a party to a
laundering transaction in those ACTIVE_HOURS. Training uses snapshots every TRAIN_STEP_HOURS;
validation and test use non-overlapping daily snapshots. Features never see anything after t.
"""
import sys
import time

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score
from xgboost import XGBClassifier

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split

from .ablation import FEATURE_SETS, best_f1_threshold
from .dataset import currency_medians
from .features import build_features
from .model import calibrated
from .ring_eval import evaluate
from .rings import detect_rings

HISTORY_HOURS, ACTIVE_HOURS, TRAIN_STEP_HOURS = 48, 24, 12


def snapshot(tx: pd.DataFrame, t: pd.Timestamp, ccy: dict, history=HISTORY_HOURS, active=ACTIVE_HOURS):
    """Features, labels and the edges used, for the accounts active in the `active` hours up to t."""
    hist = tx[(tx["ts"] <= t) & (tx["ts"] > t - pd.Timedelta(hours=history))]
    recent = hist[hist["ts"] > t - pd.Timedelta(hours=active)]
    started = time.time()
    feats = build_features(hist, ccy)
    seconds = time.time() - started
    accounts = pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))
    bad = recent[recent["is_laundering"] == 1]
    positive = set(bad["src"]) | set(bad["dst"])
    X = feats.loc[accounts]
    return X, pd.Series(X.index.isin(list(positive)).astype("int8"), index=X.index), hist, positive, seconds


def cutoffs(tx, split):
    start = tx["ts"].min().normalize() + pd.Timedelta(hours=HISTORY_HOURS)
    ends = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    train = list(pd.date_range(start, ends["train"], freq=f"{TRAIN_STEP_HOURS}h"))
    # the first label window of val (test) starts exactly where train (val) ends, so label windows never overlap
    day = pd.Timedelta(hours=ACTIVE_HOURS)
    val = list(pd.date_range(ends["train"] + day, ends["val"], freq=f"{ACTIVE_HOURS}h"))
    test = list(pd.date_range(ends["val"] + day, ends["test"], freq=f"{ACTIVE_HOURS}h"))
    return {"train": train, "val": val, "test": test}


def run(variant: str = "HI-Small", top_fraction: float = 0.01) -> None:
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    ccy = currency_medians(tx[split == "train"])
    patterns = load_patterns(variant, keys)
    grid = cutoffs(tx, split)
    print({k: [str(t) for t in v] for k, v in grid.items()}, flush=True)

    data, seconds = {}, []
    for name, times in grid.items():
        parts = []
        for t in times:
            X, y, hist, positive, secs = snapshot(tx, t, ccy)
            seconds.append(secs)
            parts.append((t, X, y, hist if name == "test" else None, positive))  # edges only needed to form test rings
        data[name] = parts
    stack = {k: (pd.concat([p[1] for p in v]), pd.concat([p[2] for p in v])) for k, v in data.items()}
    print(f"rows (positives): " + ", ".join(f"{k} {len(v[0]):,} ({int(v[1].sum())})" for k, v in stack.items()), flush=True)
    print(f"feature build per snapshot: median {np.median(seconds):.1f}s, max {np.max(seconds):.1f}s "
          f"(history {HISTORY_HOURS}h)", flush=True)

    rows = []
    for name, cols in FEATURE_SETS.items():
        (Xtr, ytr), (Xva, yva), (Xte, yte) = stack["train"], stack["val"], stack["test"]
        model = XGBClassifier(n_estimators=800, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
                              scale_pos_weight=float((ytr == 0).sum() / max(ytr.sum(), 1)), eval_metric="aucpr",
                              early_stopping_rounds=40, tree_method="hist", n_jobs=-1, random_state=0)
        model.fit(Xtr[cols], ytr, eval_set=[(Xva[cols], yva)], verbose=False)
        thr = best_f1_threshold(yva, model.predict_proba(Xva[cols])[:, 1])
        p = model.predict_proba(Xte[cols])[:, 1]
        pred = p >= thr
        tp = int((pred & (yte.to_numpy() == 1)).sum())
        prec, rec = tp / max(int(pred.sum()), 1), tp / max(int(yte.sum()), 1)
        rows.append({"features": name, "trees": model.best_iteration + 1, "positives": int(yte.sum()),
                     "pr_auc": average_precision_score(yte, p), "precision": prec, "recall": rec,
                     "f1": 2 * prec * rec / max(prec + rec, 1e-12)})
    print("\n-- account level, test snapshots --")
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print(pd.DataFrame(rows).to_string(index=False))

    # ring level on the test snapshots, graph model only versus transaction-only, averaged over snapshots
    ring_rows = []
    for name in ("transaction-only", "+ k-core, clustering, components"):
        cols = FEATURE_SETS[name]
        (Xtr, ytr), (Xva, yva) = stack["train"], stack["val"]
        model = XGBClassifier(n_estimators=800, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
                              scale_pos_weight=float((ytr == 0).sum() / max(ytr.sum(), 1)), eval_metric="aucpr",
                              early_stopping_rounds=40, tree_method="hist", n_jobs=-1, random_state=0)
        model.fit(Xtr[cols], ytr, eval_set=[(Xva[cols], yva)], verbose=False)
        margin_va = model.predict(Xva[cols], output_margin=True)
        from sklearn.linear_model import LogisticRegression
        lr = LogisticRegression(C=1e6, max_iter=1000).fit(margin_va.reshape(-1, 1), yva)
        cal = (float(lr.coef_[0, 0]), float(lr.intercept_[0]))
        for t, X, y, hist, positive in data["test"]:
            scores = pd.Series(calibrated(model.predict(X[cols], output_margin=True), cal), index=X.index)
            rings = detect_rings(scores, hist, top_fraction)
            window = (t - pd.Timedelta(hours=ACTIVE_HOURS), t)
            ring_rows.append({"model": name, "cutoff": t, **evaluate(rings, patterns, positive, window)})
    out = pd.DataFrame(ring_rows)
    summary = out.groupby("model")[["true_rings", "rings", "recovery", "mean_purity", "pure_rings"]].mean()
    print("\n-- ring level, mean over test snapshots (top %.1f%% flagged) --" % (top_fraction * 100))
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print(summary.to_string())


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
