"""Time-to-detection: how soon after a ring starts do we catch it?

Usage (from the repo root):  python -m ml.detection_time HI-Small [bundle folder] [step hours]

Replays the test window through the same Scorer the API serves. At every step (default 6 hours) it is
given only the transactions up to that moment, scores the accounts active in the last 24 hours, and forms
rings with the bundle's own settings. The saved model folder is compared with its own plain account model
(the payment model switched off), so both see the same data at the same moments.

A laundering pattern that starts in the test window counts as detected at the first step where one detected
ring holds at least half of the pattern's accounts seen so far (and at least two). Time-to-detection is that
step minus the pattern's first transaction.
"""
import dataclasses
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split
from data.paths import DATA_DIR

from .bundle import load_bundle
from .service import Scorer

MIN_SEEN = 2
COVER = 0.5
ACTIVE_HOURS = 24


def run(variant: str, bundle_dir: Path, step_hours: int = 6) -> pd.DataFrame:
    bundle = load_bundle(bundle_dir)
    models = {"saved model": bundle}
    if bundle.payment is not None:  # the same folder with the payment model off: the plain account model
        models["account model only"] = dataclasses.replace(bundle, payment=None, stage2=None, top_fraction=0.01,
                                                           grow_fraction=None)
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    cut_val, cut_test = tx.loc[split == "val", "ts"].max(), tx.loc[split == "test", "ts"].max()
    patterns = [p for p in load_patterns(variant, keys) if p["first_ts"] > cut_val and len(p["accounts"]) >= 3]
    print(f"{len(patterns)} laundering patterns start in the test window", flush=True)

    steps = list(pd.date_range(cut_val + pd.Timedelta(hours=step_hours), cut_test, freq=f"{step_hours}h")) + [cut_test]
    detected = {name: {} for name in models}
    for t in steps:
        started = time.time()
        hist = tx[tx["ts"] <= t]
        for name, b in models.items():
            scorer = Scorer.from_transactions(b, hist, active_since=t - pd.Timedelta(hours=ACTIVE_HOURS))
            owner = {a: i for i, ring in enumerate(scorer.rings) for a in ring.members}
            for p in patterns:
                if p["pattern_id"] in detected[name] or p["first_ts"] > t:
                    continue
                seen = {a for ts, a in p["events"] if ts <= t}
                counts = pd.Series([owner[a] for a in seen if a in owner]).value_counts()
                if len(seen) >= MIN_SEEN and len(counts) and counts.iloc[0] >= MIN_SEEN and counts.iloc[0] / len(seen) >= COVER:
                    detected[name][p["pattern_id"]] = t
        print(f"  step {t}: {time.time() - started:.0f}s for {len(models)} model(s)", flush=True)

    rows = []
    for name in models:
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
    v = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    folder = Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / v
    with pd.option_context("display.float_format", "{:.2f}".format, "display.width", 200):
        print(run(v, folder, int(sys.argv[3]) if len(sys.argv) > 3 else 6).to_string(index=False))
