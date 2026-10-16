"""Ring-level evaluation against the IBM laundering patterns.

Usage (from the repo root):  python -m ml.ring_eval HI-Small

A true ring is one laundering pattern from <variant>_Patterns.txt that has activity in the window.
  recovery   share of true rings where one detected ring holds at least half of the pattern's accounts
  purity     share of a detected ring's members that touch a laundering transaction in the window
  pure rings share of detected rings with purity of at least 50%
The top-fraction setting is chosen on val and then applied to test.
"""
import sys
from collections import Counter

import numpy as np
import pandas as pd

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split

from .dataset import make_snapshots
from .features import BEHAVIOR_COLS, GRAPH_COLS, STRUCTURE_COLS, TX_COLS
from .model import fit_calibration, fit_model, score
from .rings import detect_rings

TOP_FRACTIONS = [0.005, 0.01, 0.02, 0.05]
COVER = 0.5

MODELS = {"transaction-only": TX_COLS, "graph features": TX_COLS + BEHAVIOR_COLS + GRAPH_COLS + STRUCTURE_COLS}


def evaluate(rings, patterns, positives: set, window: tuple) -> dict:
    from sklearn.metrics import average_precision_score  # evaluation only, not needed for serving

    lo, hi = window
    active = [p for p in patterns if p["last_ts"] > lo and p["first_ts"] <= hi and len(p["accounts"]) >= 2]
    owner = {}
    for i, ring in enumerate(rings):
        for a in ring.members:
            owner[a] = i
    recovered, best_cover = 0, []
    for p in active:
        counts = Counter(owner[a] for a in p["accounts"] if a in owner)
        cover = max(counts.values()) / len(p["accounts"]) if counts else 0.0
        best_cover.append(cover)
        recovered += cover >= COVER
    purity = np.array([np.mean([a in positives for a in r.members]) for r in rings]) if rings else np.array([])
    pure = purity >= 0.5
    ap = average_precision_score(pure, [r.risk for r in rings]) if rings and 0 < pure.sum() < len(pure) else float("nan")
    return {"rings": len(rings), "true_rings": len(active),
            "recovery": recovered / max(len(active), 1), "mean_cover": float(np.mean(best_cover)) if best_cover else 0.0,
            "mean_purity": float(purity.mean()) if len(purity) else 0.0,
            "pure_rings": float(pure.mean()) if len(purity) else 0.0, "ring_score_ap": ap}


def run(variant: str) -> None:
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    patterns = load_patterns(variant, keys)
    snaps = make_snapshots(variant)
    cut = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    windows = {"val": (cut["train"], cut["val"]), "test": (cut["val"], cut["test"])}
    positives = {k: set(snaps[k].y.index[snaps[k].y == 1]) for k in windows}
    print(f"{len(patterns)} laundering patterns in {variant}")

    rows = []
    for name, cols in MODELS.items():
        model = fit_model(snaps["train"], snaps["val"], cols)
        calibration = fit_calibration(model, snaps["val"], cols)
        for k in ("val", "test"):
            scores = score(model, snaps[k], cols, calibration)
            hist = tx[tx["ts"] <= cut[k]]
            for frac in TOP_FRACTIONS:
                rings = detect_rings(scores, hist, frac)
                rows.append({"model": name, "split": k, "top": frac,
                             **evaluate(rings, patterns, positives[k], windows[k])})
    out = pd.DataFrame(rows)
    out["selection"] = out["recovery"] * out["pure_rings"]
    chosen = out[out["split"] == "val"].sort_values("selection").groupby("model").tail(1).set_index("model")["top"]
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 220):
        print("\n-- all settings --")
        print(out.drop(columns="selection").to_string(index=False))
        print("\n-- test, top fraction chosen on val --")
        pick = out[(out["split"] == "test") & out.apply(lambda r: r["top"] == chosen[r["model"]], axis=1)]
        print(pick.drop(columns="selection").to_string(index=False))


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
