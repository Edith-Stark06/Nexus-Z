"""Time-to-detection: how soon after a ring starts do we catch it?

Usage (from the repo root):  python -m ml.detection_time HI-Small

Replays the test window. At every step (default 6 hours) the features, scores and rings are
rebuilt from only the transactions up to that moment, using accounts active in the last 24 hours.
A laundering pattern that starts in the test window counts as detected at the first step where one
detected ring holds at least half of the pattern's accounts seen so far (and at least two).
Time-to-detection is that step minus the pattern's first transaction.
"""
import sys
import time

import numpy as np
import pandas as pd

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split

from .dataset import currency_medians, make_snapshots
from .features import build_features
from .model import calibrated, fit_calibration, fit_model
from .ring_eval import MODELS
from .rings import detect_rings

MIN_SEEN = 2
COVER = 0.5
ACTIVE_HOURS = 24


def run(variant: str, step_hours: int = 6, top_fraction: float = 0.01) -> pd.DataFrame:
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    cut_val, cut_test = tx.loc[split == "val", "ts"].max(), tx.loc[split == "test", "ts"].max()
    patterns = [p for p in load_patterns(variant, keys) if p["first_ts"] > cut_val and len(p["accounts"]) >= 3]
    print(f"{len(patterns)} laundering patterns start in the test window", flush=True)

    snaps = make_snapshots(variant)
    ccy = currency_medians(tx[split == "train"])
    models = {}
    for name, cols in MODELS.items():
        model = fit_model(snaps["train"], snaps["val"], cols)
        models[name] = (model, cols, fit_calibration(model, snaps["val"], cols))

    steps = list(pd.date_range(cut_val + pd.Timedelta(hours=step_hours), cut_test, freq=f"{step_hours}h")) + [cut_test]
    detected = {name: {} for name in MODELS}
    for t in steps:
        started = time.time()
        hist = tx[tx["ts"] <= t]
        feats = build_features(hist, ccy)
        recent = hist[hist["ts"] > t - pd.Timedelta(hours=ACTIVE_HOURS)]
        X = feats.loc[pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))]
        for name, (model, cols, cal) in models.items():
            import xgboost as xgb
            scores = pd.Series(calibrated(model.get_booster().predict(xgb.DMatrix(X[cols]), output_margin=True), cal),
                               index=X.index)
            owner = {a: i for i, ring in enumerate(detect_rings(scores, hist, top_fraction)) for a in ring.members}
            for p in patterns:
                if p["pattern_id"] in detected[name] or p["first_ts"] > t:
                    continue
                seen = {a for ts, a in p["events"] if ts <= t}
                counts = pd.Series([owner[a] for a in seen if a in owner]).value_counts()
                if len(seen) >= MIN_SEEN and len(counts) and counts.iloc[0] >= MIN_SEEN and counts.iloc[0] / len(seen) >= COVER:
                    detected[name][p["pattern_id"]] = t
        print(f"  step {t}: {time.time() - started:.0f}s", flush=True)

    rows = []
    for name in MODELS:
        hours = np.array([(detected[name][p["pattern_id"]] - p["first_ts"]).total_seconds() / 3600
                          for p in patterns if p["pattern_id"] in detected[name]])
        early = sum(detected[name][p["pattern_id"]] < p["last_ts"] for p in patterns if p["pattern_id"] in detected[name])
        rows.append({"model": name, "patterns": len(patterns), "detected": len(hours),
                     "detected_share": len(hours) / len(patterns),
                     "median_hours": float(np.median(hours)) if len(hours) else float("nan"),
                     "p90_hours": float(np.percentile(hours, 90)) if len(hours) else float("nan"),
                     "caught_before_last_payment": early / len(patterns)})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    with pd.option_context("display.float_format", "{:.2f}".format, "display.width", 200):
        print(run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small").to_string(index=False))
