"""Does growing rings through weaker accounts raise recovery without hurting purity?

Usage (from the repo root):  python -m ml.ring_grow_eval HI-Small [seed]

Account scores come from the payment model (ml/edge_model.py) and are cached. A ring must contain at least one
account from the strict top share; with growth it may also take in linked accounts from a wider top share.
The setting is chosen on validation and reported on test, as in ring_eval.
"""
import sys

import pandas as pd

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split
from data.paths import DATA_DIR

from .dataset import currency_medians, make_snapshots
from .edge_model import account_scores, fit_payment_model, payment_probabilities
from .features import FEATURE_VERSION
from .ablation import FEATURE_SETS
from .ring_eval import evaluate
from .rings import detect_rings

STRICT = [0.0025, 0.005, 0.01]
GROW = [None, 0.02, 0.05]


def payment_scores(variant: str, seed: int, tx, split, snaps) -> dict:
    cache = DATA_DIR / "cache" / f"payment_scores_{variant}_s{seed}_v{FEATURE_VERSION}.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    ccy = currency_medians(tx[split == "train"])
    cols = FEATURE_SETS["+ k-core, clustering, components"]
    model, cal, p_val = fit_payment_model(tx, split, snaps, cols, ccy, seed=seed)
    out = {}
    for k, p in (("val", p_val), ("test", None)):
        window = tx[split == k].reset_index(drop=True)
        if p is None:
            hist = tx[tx["ts"] <= window["ts"].max()]
            p = payment_probabilities(model, cal, window, hist, snaps[k].all_X, cols, ccy)
        out[k] = account_scores(window, p).reindex(snaps[k].X.index).fillna(0.0)
    cache.parent.mkdir(parents=True, exist_ok=True)
    pd.to_pickle(out, cache)
    return out


def run(variant: str = "HI-Small", seed: int = 0) -> None:
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    patterns = load_patterns(variant, keys)
    snaps = make_snapshots(variant)
    scores = payment_scores(variant, seed, tx, split, snaps)
    cut = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    windows = {"val": (cut["train"], cut["val"]), "test": (cut["val"], cut["test"])}
    positives = {k: set(snaps[k].y.index[snaps[k].y == 1]) for k in windows}
    rows = []
    for k in ("val", "test"):
        hist = tx[tx["ts"] <= cut[k]]
        for strict in STRICT:
            for grow in GROW:
                if grow is not None and grow <= strict:
                    continue
                rings = detect_rings(scores[k], hist, strict, grow_fraction=grow)
                rows.append({"split": k, "strict": strict, "grow": grow if grow is not None else 0.0, **evaluate(rings, patterns, positives[k], windows[k])})
    out = pd.DataFrame(rows)
    out["selection"] = out["recovery"] * out["pure_rings"]
    keep = ["strict", "grow", "rings", "true_rings", "recovery", "mean_purity", "pure_rings"]
    best = out[out["split"] == "val"].sort_values("selection").iloc[-1]
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        for k in ("val", "test"):
            print(f"-- {k} (grow 0 means no growth) --")
            print(out[out["split"] == k][keep].to_string(index=False))
        pick = out[(out["split"] == "test") & (out["strict"] == best["strict"]) & (out["grow"] == best["grow"])]
        print("\n-- test, setting chosen on validation --")
        print(pick[keep].to_string(index=False))
        nogrow = out[(out["split"] == "test") & (out["grow"] == 0.0)]
        print("\n-- test, no growth, for comparison --")
        print(nogrow[keep].to_string(index=False))


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small", int(sys.argv[2]) if len(sys.argv) > 2 else 0)
