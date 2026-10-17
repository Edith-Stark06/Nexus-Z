"""Single-stage against two-stage model, at account level and at ring level.

Usage (from the repo root):  python -m ml.stack_eval HI-Small [seeds]

Both models use the same features (the full set with bursts and motifs). The two-stage model also
sees summaries of its neighbors' stage-1 scores (see ml/stack.py). Seeds only change training
randomness; the split and data are the same, so the spread is training noise, not split noise.
"""
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split

from .ablation import FEATURE_SETS, best_f1_threshold
from .dataset import make_snapshots
from .model import fit_calibration, fit_model, score
from .ring_eval import evaluate
from .rings import detect_rings
from .stack import fit_stacked

TOP_FRACTIONS = [0.005, 0.01, 0.02, 0.05]
FEATURES = "+ bursts and motifs"


def account_row(name, scores_val, scores_test, val, test) -> dict:
    thr = best_f1_threshold(val.y, scores_val)
    p, y = scores_test.to_numpy(), test.y.to_numpy()
    new = ~test.seen_positive.to_numpy()
    pred = p >= thr
    tp = int((pred & (y == 1)).sum())
    prec, rec = tp / max(int(pred.sum()), 1), tp / max(int(y.sum()), 1)
    return {"model": name, "pr_auc": average_precision_score(y, p), "pr_auc_new_accounts": average_precision_score(y[new], p[new]),
            "precision": prec, "recall": rec, "f1": 2 * prec * rec / max(prec + rec, 1e-12)}


def run(variant: str = "HI-Small", seeds: int = 1) -> None:
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    patterns = load_patterns(variant, keys)
    snaps = make_snapshots(variant)
    tr, va, te = snaps["train"], snaps["val"], snaps["test"]
    cols = FEATURE_SETS[FEATURES]
    cut = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    windows = {"val": (cut["train"], cut["val"]), "test": (cut["val"], cut["test"])}
    positives = {k: set(snaps[k].y.index[snaps[k].y == 1]) for k in windows}

    account_rows, last = [], {}
    for seed in range(seeds):
        single = fit_model(tr, va, cols, seed)
        cal = fit_calibration(single, va, cols)
        stacked = fit_stacked(tr, va, cols, seed=seed)
        sources = {"single stage": {k: score(single, snaps[k], cols, cal) for k in ("val", "test")},
                   "two stage": {k: stacked.score(snaps[k]) for k in ("val", "test")}}
        for name, s in sources.items():
            account_rows.append({"seed": seed, **account_row(name, s["val"], s["test"], va, te)})
        last = sources
    acc = pd.DataFrame(account_rows)
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print("-- account level, test --")
        print(acc.to_string(index=False))
        if seeds > 1:
            print("\n-- mean and spread over seeds --")
            print(acc.groupby("model")[["pr_auc", "pr_auc_new_accounts", "precision", "recall", "f1"]].agg(["mean", "std"]).to_string())

    ring_rows = []
    for name, s in last.items():  # rings from the last seed
        for k in ("val", "test"):
            hist = tx[tx["ts"] <= cut[k]]
            for frac in TOP_FRACTIONS:
                rings = detect_rings(s[k], hist, frac)
                ring_rows.append({"model": name, "split": k, "top": frac, **evaluate(rings, patterns, positives[k], windows[k])})
    out = pd.DataFrame(ring_rows)
    out["selection"] = out["recovery"] * out["pure_rings"]
    chosen = out[out["split"] == "val"].sort_values("selection").groupby("model").tail(1).set_index("model")["top"]
    keep = ["model", "top", "rings", "true_rings", "recovery", "mean_purity", "pure_rings"]
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print("\n-- ring level, all settings --")
        print(out[keep + ["split"]].to_string(index=False))
        print("\n-- ring level, test, flagged fraction chosen on validation --")
        pick = out[(out["split"] == "test") & out.apply(lambda r: r["top"] == chosen[r["model"]], axis=1)]
        print(pick[keep].to_string(index=False))


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small", int(sys.argv[2]) if len(sys.argv) > 2 else 1)
