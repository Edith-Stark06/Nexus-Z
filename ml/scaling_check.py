"""Measure how scoring and training scale on this machine (run on the LinuxONE VM, with nothing else running).

Usage (from the repo root):  python -m ml.scaling_check HI-Small [bundle folder]

1. Window scaling: rescore the last 6, 12, 24, 48, 96, 192 hours and the whole period of HI-Small, and time
   feature building and scoring plus ring formation, with peak memory.
2. Thread scaling: train and predict with XGBoost on 1, 2 and 3 threads (fixed number of trees, so the
   work is identical), to show how well the machine's cores are used.
Every number printed is measured here, on this machine, in this run.
"""
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBClassifier

from data.ibm_aml import load_transactions, primary_period
from data.paths import DATA_DIR

from .bundle import load_bundle
from .dataset import make_snapshots
from .features import build_features
from .service import Scorer

WINDOWS_H = [6, 12, 24, 48, 96, 192, None]  # None means the whole primary period


def peak_mb() -> float:
    try:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    except ImportError:
        return float("nan")


def window_scaling(variant: str, bundle_dir: Path) -> pd.DataFrame:
    bundle = load_bundle(bundle_dir)
    tx = primary_period(load_transactions(variant), variant)
    end = tx["ts"].max()
    rows = []
    for hours in WINDOWS_H:
        part = tx if hours is None else tx[tx["ts"] > end - pd.Timedelta(hours=hours)]
        started = time.time()
        feats = build_features(part, bundle.ccy_median)
        t_features = time.time() - started
        recent = part[part["ts"] > part["ts"].max() - pd.Timedelta(hours=24)]
        X = feats.loc[pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))]
        started = time.time()
        scorer = Scorer(bundle, X, part, part["ts"].max())
        t_score = time.time() - started
        rows.append({"window": "all" if hours is None else f"{hours} h", "transactions": len(part), "accounts": len(feats),
                     "scored": len(X), "rings": len(scorer.rings), "features_s": t_features, "score_rings_s": t_score,
                     "total_s": t_features + t_score, "tx_per_s": len(part) / (t_features + t_score), "peak_mb": peak_mb()})
    return pd.DataFrame(rows)


def thread_scaling(variant: str) -> pd.DataFrame:
    from .ablation import FEATURE_SETS

    snaps = make_snapshots(variant)
    cols = FEATURE_SETS["+ bursts and motifs"]
    tr, te = snaps["train"], snaps["test"]
    rows = []
    for threads in (1, 2, 3):
        model = XGBClassifier(n_estimators=200, learning_rate=0.1, max_depth=6, tree_method="hist", n_jobs=threads,
                              scale_pos_weight=float((tr.y == 0).sum() / tr.y.sum()), random_state=0)
        started = time.time()
        model.fit(tr.X[cols], tr.y)
        t_train = time.time() - started
        started = time.time()
        for _ in range(3):
            model.predict_proba(te.X[cols])
        t_predict = (time.time() - started) / 3
        rows.append({"threads": threads, "train_s": t_train, "predict_s": t_predict,
                     "predict_accounts_per_s": len(te.X) / t_predict})
    out = pd.DataFrame(rows)
    out["train_speedup"] = out["train_s"].iloc[0] / out["train_s"]
    out["predict_speedup"] = out["predict_s"].iloc[0] / out["predict_s"]
    return out


if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    bundle_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / variant
    print(f"{platform.machine()} ({sys.byteorder}-endian), {os.cpu_count()} cpus, {variant}", flush=True)
    with pd.option_context("display.float_format", "{:.2f}".format, "display.width", 220):
        print("\n-- window scaling: full rescore of the last N hours --")
        print(window_scaling(variant, bundle_dir).to_string(index=False), flush=True)
        print("\n-- thread scaling: XGBoost, 200 trees, identical work --")
        print(thread_scaling(variant).to_string(index=False))
