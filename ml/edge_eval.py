"""Payment-level model against the account-level model, scored on accounts and on rings.

Usage (from the repo root):  python -m ml.edge_eval HI-Small [negative keep rate] [seed] [endpoint feature set name]

Training keeps every laundering payment and a random share of the others (default 5%), because there are
about 1 laundering payment per 1,300. Validation and test use every payment. Account scores are the highest
payment score in the window, calibrated on validation. The account-level baseline uses the same account
features, trained the usual way. Same split, same protocol, same metrics for both.
"""
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from data.ibm_aml import load_patterns, load_with_index, primary_period, time_split

from .ablation import FEATURE_SETS, best_f1_threshold
from .dataset import currency_medians, make_snapshots
from .edge_model import account_scores, fit_payment_model, payment_probabilities
from .model import fit_calibration, fit_model, score
from .ring_eval import evaluate
from .rings import detect_rings
from .stack_eval import account_row

TOP_FRACTIONS = [0.005, 0.01, 0.02, 0.05]
FEATURES = "+ k-core, clustering, components"


def platt(margin: np.ndarray, y: np.ndarray) -> tuple:
    from sklearn.linear_model import LogisticRegression

    lr = LogisticRegression(C=1e6, max_iter=1000).fit(margin.reshape(-1, 1), y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def run(variant: str = "HI-Small", keep_rate: float = 0.05, seed: int = 0, features: str = FEATURES) -> None:
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    split = time_split(tx)
    patterns = load_patterns(variant, keys)
    snaps = make_snapshots(variant)
    ccy = currency_medians(tx[split == "train"])
    cols = FEATURE_SETS[features]
    print(f"endpoint feature set: {features} ({len(cols)} columns), keep rate {keep_rate}, seed {seed}", flush=True)
    cut = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    windows = {"val": (cut["train"], cut["val"]), "test": (cut["val"], cut["test"])}
    positives = {k: set(snaps[k].y.index[snaps[k].y == 1]) for k in windows}
    win = {k: tx[split == k].reset_index(drop=True) for k in ("train", "val", "test")}
    hist = {k: tx[tx["ts"] <= cut[k]] for k in ("train", "val", "test")}

    model, cal, p_va = fit_payment_model(tx, split, snaps, cols, ccy, keep_rate, seed)
    p_te = payment_probabilities(model, cal, win["test"], hist["test"], snaps["test"].all_X, cols, ccy)
    yva, yte = win["val"]["is_laundering"].to_numpy(), win["test"]["is_laundering"].to_numpy()
    print(f"payment model: {model.best_iteration + 1} trees; payment-level PR-AUC val {average_precision_score(yva, p_va):.3f}, "
          f"test {average_precision_score(yte, p_te):.3f} (chance {yte.mean():.4f})", flush=True)

    base = fit_model(snaps["train"], snaps["val"], cols, seed)
    base_cal = fit_calibration(base, snaps["val"], cols)
    scores = {
        "account model": {k: score(base, snaps[k], cols, base_cal) for k in ("val", "test")},
        "payment model (max per account)": {
            k: account_scores(win[k], p).reindex(snaps[k].X.index).fillna(0.0)
            for k, p in (("val", p_va), ("test", p_te))},
    }
    acc = pd.DataFrame([account_row(n, s["val"], s["test"], snaps["val"], snaps["test"]) for n, s in scores.items()])
    ring_rows = []
    for name, s in scores.items():
        for k in ("val", "test"):
            for frac in TOP_FRACTIONS:
                rings = detect_rings(s[k], hist[k], frac)
                ring_rows.append({"model": name, "split": k, "top": frac, **evaluate(rings, patterns, positives[k], windows[k])})
    out = pd.DataFrame(ring_rows)
    out["selection"] = out["recovery"] * out["pure_rings"]
    chosen = out[out["split"] == "val"].sort_values("selection").groupby("model").tail(1).set_index("model")["top"]
    keep = ["model", "top", "rings", "true_rings", "recovery", "mean_purity", "pure_rings"]
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print("\n-- account level, test --")
        print(acc.to_string(index=False))
        print("\n-- ring level, all settings --")
        print(out[keep + ["split"]].to_string(index=False))
        print("\n-- ring level, test, flagged fraction chosen on validation --")
        pick = out[(out["split"] == "test") & out.apply(lambda r: r["top"] == chosen[r["model"]], axis=1)]
        print(pick[keep].to_string(index=False))


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small", float(sys.argv[2]) if len(sys.argv) > 2 else 0.05,
        int(sys.argv[3]) if len(sys.argv) > 3 else 0, sys.argv[4] if len(sys.argv) > 4 else FEATURES)
