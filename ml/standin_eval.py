"""Evaluate on pig-butchering rings and legitimate look-alikes injected into IBM AML (stand-in data).

Usage (from the repo root):  python -m ml.standin_eval HI-Small [seed]

Models are trained on the combined labels (IBM laundering plus injected fraud accounts). Metrics:
  account level   PR-AUC on injected fraud accounts only (IBM laundering accounts are left out of the
                  ranking), recall of injected fraud accounts at the val-chosen threshold, and how
                  many legitimate hubs (merchants, payroll, landlords, charities) are wrongly flagged
  ring level      share of injected rings recovered, by shape, and how many detected rings are
                  mostly legitimate hubs
The generator is ml/standin_rings.py. It is a stand-in for the data workstream's generator.
"""
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from data.ibm_aml import load_with_index, primary_period, time_split

from .ablation import FEATURE_SETS, best_f1_threshold
from .dataset import make_snapshots
from .model import fit_calibration, fit_model, score
from .ring_eval import evaluate
from .rings import detect_rings
from .standin_rings import RING_KINDS, inject

TOP_FRACTIONS = [0.005, 0.01, 0.02]


def run(variant: str = "HI-Small", seed: int = 0) -> None:
    tx, _ = load_with_index(variant)
    tx = primary_period(tx, variant)
    inj = inject(tx, seed=seed)
    tx2 = inj.tx
    split = time_split(tx2)
    cut = {k: tx2.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    windows = {"val": (cut["train"], cut["val"]), "test": (cut["val"], cut["test"])}
    snaps = make_snapshots(variant, tx=tx2, tag=f"-standin{seed}")

    pig = set().union(*[r["accounts"] for r in inj.rings])
    hard = set().union(*[h["accounts"] for h in inj.hard])
    te = snaps["test"]
    in_pig = te.X.index.isin(list(pig))
    in_hard = te.X.index.isin(list(hard))
    y = te.y.to_numpy() == 1
    y_pig = y & in_pig
    keep = ~(y & ~in_pig)  # leave IBM laundering accounts out of the injected-only ranking
    print(f"injected: {len(inj.rings)} rings ({len(pig)} fraud accounts), {len(inj.hard)} look-alikes "
          f"({len(hard)} hub/settlement accounts)")
    print(f"test candidates: {len(te.X):,}; injected fraud accounts active with a laundering hop: {int(y_pig.sum())}; "
          f"legitimate hub accounts active: {int(in_hard.sum())}", flush=True)

    rows, fitted = [], {}
    for name, cols in FEATURE_SETS.items():
        model = fit_model(snaps["train"], snaps["val"], cols)
        cal = fit_calibration(model, snaps["val"], cols)
        fitted[name] = (cols, model, cal)
        thr = best_f1_threshold(snaps["val"].y, score(model, snaps["val"], cols, cal))
        p = score(model, te, cols, cal).to_numpy()
        rows.append({"features": name, "pr_auc_injected": average_precision_score(y_pig[keep], p[keep]),
                     "recall_injected": float((p[y_pig] >= thr).mean()),
                     "hubs_flagged": f"{int((p[in_hard] >= thr).sum())} of {int(in_hard.sum())}"})
    print("\n-- account level (test) --")
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print(pd.DataFrame(rows).to_string(index=False))

    positives = {k: set(snaps[k].y.index[snaps[k].y == 1]) for k in windows}
    ring_rows = []
    for name in ("transaction-only", list(FEATURE_SETS)[-1]):  # compare no-graph against the full feature set
        cols, model, cal = fitted[name]
        for k in ("val", "test"):
            scores = score(model, snaps[k], cols, cal)
            hist = tx2[tx2["ts"] <= cut[k]]
            for frac in TOP_FRACTIONS:
                rings = detect_rings(scores, hist, frac)
                overall = evaluate(rings, inj.rings, positives[k], windows[k])
                by_kind = {kind: evaluate(rings, [r for r in inj.rings if r["type"] == kind], positives[k], windows[k])["recovery"]
                           for kind in RING_KINDS}
                hubby = sum(np.mean([a in hard for a in r.members]) >= 0.5 for r in rings)
                ring_rows.append({"model": name, "split": k, "top": frac, "rings": len(rings),
                                  "true_rings": overall["true_rings"], "recovery": overall["recovery"],
                                  **{f"rec_{kind}": by_kind[kind] for kind in RING_KINDS},
                                  "pure_rings": overall["pure_rings"], "hub_rings": hubby})
    out = pd.DataFrame(ring_rows)
    out["selection"] = out["recovery"] * out["pure_rings"]
    chosen = out[out["split"] == "val"].sort_values("selection").groupby("model").tail(1).set_index("model")["top"]
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 250):
        print("\n-- ring level, all settings --")
        print(out.drop(columns="selection").to_string(index=False))
        pick = out[(out["split"] == "test") & out.apply(lambda r: r["top"] == chosen[r["model"]], axis=1)]
        print("\n-- ring level, test, flagged fraction chosen on val --")
        print(pick.drop(columns="selection").to_string(index=False))


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small", int(sys.argv[2]) if len(sys.argv) > 2 else 0)
