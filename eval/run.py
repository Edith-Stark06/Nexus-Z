"""Independent evaluation of the NEXUS Z models on data from data/rings.py.

Usage (from the repo root):
    python -m eval.run HI-Small --seeds 0 1 2 [--scenario default] [--step-hours 6] [--no-replay]
    python -m eval.run --list-scenarios

Each seed injects a different set of rings and look-alikes into the IBM background, trains the four feature
sets from the ablation, and measures the test window with the metrics in eval/metrics.py against the
generator's own ground truth. The ML code is called only to build snapshots, fit and score models,
and detect rings. Results go to eval/results/<scenario>/ (raw CSVs) and eval/results/RESULTS.md.

Protocol (ml/PROTOCOL.md): time split; features only from edges up to the cutoff; the score threshold
and the flagged fraction are chosen on val and applied to test; the test window is read once per seed.
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from data.ibm_aml import load_with_index, primary_period, time_split
from data.rings import HARD_KINDS, RING_KINDS, inject
from ml.ablation import FEATURE_SETS
from ml.dataset import currency_medians, make_snapshots
from ml.features import build_features
from ml.model import calibrated, fit_calibration, fit_model, score
from ml.rings import detect_rings

from . import metrics as M

RESULTS = Path(__file__).parent / "results"
TOP_FRACTIONS = [0.005, 0.01, 0.02, 0.05]
ACTIVE_HOURS = 24
SCENARIOS = {
    "default": {},
    "fast-rings-only": {"kinds": ["fan-in", "dispersed", "chain"]},
    "slow-rings-only": {"kinds": ["delayed", "batched", "mixed"]},
    "no-adversarial": {"adversarial": 0.0},
    "all-adversarial": {"adversarial": 1.0},
    "aged-accounts": {"aged_share": 1.0},
    "few-rings": {"n_rings": 30},
}


def _windows(tx: pd.DataFrame):
    split = time_split(tx)
    cut = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val", "test")}
    return split, cut, {"val": (cut["train"], cut["val"]), "test": (cut["val"], cut["test"])}


def _flat(rings) -> list:
    return [r.members for r in rings]


def run_seed(variant: str, seed: int, scenario: str, tx: pd.DataFrame, step_hours: int, replay: bool) -> dict[str, pd.DataFrame]:
    started = time.time()
    inj = inject(tx, seed=seed, **SCENARIOS[scenario])
    tx2 = inj.tx
    _, cut, windows = _windows(tx2)
    snaps = make_snapshots(variant, tx=tx2, tag=f"-eval-{scenario}-{seed}")
    network = set().union(*[r["accounts"] for r in inj.rings])
    hubs = {h["hub"]: h for h in inj.hard}
    hub_accounts = set().union(*[h["accounts"] for h in inj.hard])
    kinds = sorted({r["type"] for r in inj.rings}, key=RING_KINDS.index)

    laundering = tx2[tx2["is_laundering"] == 1]
    bad = {k: set(laundering.loc[laundering["ts"].between(*windows[k], inclusive="right"), ["src", "dst"]].to_numpy().ravel())
           for k in windows}
    print(f"[seed {seed}] injected {len(inj.rings)} rings ({len(network)} fraud accounts), {len(inj.hard)} look-alikes; "
          f"test rings: {len(M.active_rings(inj.rings, windows['test']))}", flush=True)

    def labels(snap, k):  # injected fraud accounts with a laundering payment in the window; other IBM positives are not ranked
        idx = snap.X.index
        y = idx.isin(list(bad[k] & network))
        keep = ~idx.isin(list(bad[k] - network))
        return y, keep

    acct, hub_rows, ring_rows, fitted = [], [], [], {}
    for name, cols in FEATURE_SETS.items():
        model = fit_model(snaps["train"], snaps["val"], cols)
        cal = fit_calibration(model, snaps["val"], cols)
        fitted[name] = (cols, model, cal)
        y_val, keep_val = labels(snaps["val"], "val")
        p_val = score(model, snaps["val"], cols, cal).to_numpy()
        thr = M.best_f1_threshold(y_val[keep_val], p_val[keep_val])

        te = snaps["test"]
        y, keep = labels(te, "test")
        p = score(model, te, cols, cal).to_numpy()
        new = ~te.seen_positive.to_numpy()
        for scope, mask in (("all candidates", keep), ("new accounts only", keep & new)):
            acct.append({"seed": seed, "model": name, "scope": scope, "positives": int(y[mask].sum()),
                         "pr_auc": M.average_precision(y[mask], p[mask]),
                         **{k: v for k, v in M.precision_recall_f1(y[mask], p[mask], thr).items() if k in ("precision", "recall", "f1")}})
        acct.append({"seed": seed, "model": name, "scope": "all labels (IBM + injected)", "positives": int(te.y.sum()),
                     "pr_auc": M.average_precision(te.y.to_numpy(), p),
                     **{k: v for k, v in M.precision_recall_f1(te.y.to_numpy(), p, thr).items() if k in ("precision", "recall", "f1")}})

        for h in inj.hard:  # hub accounts that were active in the test window
            if h["hub"] in te.X.index:
                hub_rows.append({"seed": seed, "model": name, "type": h["type"], "adversarial": h["adversarial"],
                                 "flagged": bool(p[te.X.index.get_loc(h["hub"])] >= thr)})

    chosen = {}
    for name, (cols, model, cal) in fitted.items():
        for k in ("val", "test"):
            scores = score(model, snaps[k], cols, cal)
            hist = tx2[tx2["ts"] <= cut[k]]
            truth = M.active_rings(inj.rings, windows[k])
            for frac in TOP_FRACTIONS:
                det = _flat(detect_rings(scores, hist, frac))
                rec = M.ring_recovery(det, truth)
                pure = M.ring_purity(det, bad[k])
                row = {"seed": seed, "model": name, "split": k, "top": frac, "detected_rings": len(det),
                       "true_rings": rec["true_rings"], "recovery": rec["recovery"],
                       "pure_rings": float((pure >= 0.5).mean()) if len(pure) else 0.0, "hub_rings": M.hub_rings(det, hub_accounts)}
                for kind in kinds:
                    row[f"rec_{kind}"] = M.ring_recovery(det, [r for r in truth if r["type"] == kind])["recovery"]
                ring_rows.append(row)
        sub = pd.DataFrame([r for r in ring_rows if r["model"] == name and r["split"] == "val"])
        chosen[name] = float(sub.assign(sel=sub["recovery"].fillna(0) * sub["pure_rings"]).sort_values("sel").iloc[-1]["top"])

    detect = []
    if replay:
        detect = _replay(tx2, inj, fitted, chosen, cut, windows, step_hours, seed, snaps, variant)
    print(f"[seed {seed}] done in {time.time() - started:.0f}s", flush=True)
    rings = pd.DataFrame(ring_rows)
    rings["chosen_on_val"] = [r["top"] == chosen[r["model"]] for r in ring_rows]
    return {"account": pd.DataFrame(acct), "hubs": pd.DataFrame(hub_rows), "rings": rings, "detection": pd.DataFrame(detect)}


def _replay(tx2, inj, fitted, chosen, cut, windows, step_hours, seed, snaps, variant) -> list[dict]:
    """Time to detection: replay the test window, scoring at each step with only the data up to that step."""
    rings = [r for r in inj.rings if r["first_ts"] > cut["val"] and len(r["accounts"]) >= 3]
    split = time_split(tx2)
    ccy = currency_medians(tx2[split == "train"])
    steps = list(pd.date_range(cut["val"] + pd.Timedelta(hours=step_hours), cut["test"], freq=f"{step_hours}h")) + [cut["test"]]
    detected = {name: {} for name in fitted}
    for t in steps:
        t_start = time.time()
        hist = tx2[tx2["ts"] <= t]
        feats = build_features(hist, ccy)
        recent = hist[hist["ts"] > t - pd.Timedelta(hours=ACTIVE_HOURS)]
        X = feats.loc[pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))]
        for name, (cols, model, cal) in fitted.items():
            scores = pd.Series(calibrated(model.predict(X[cols], output_margin=True), cal), index=X.index)
            owner = {a: i for i, members in enumerate(_flat(detect_rings(scores, hist, chosen[name]))) for a in members}
            for r in rings:
                if r["pattern_id"] in detected[name] or r["first_ts"] > t:
                    continue
                seen = {a for ts, a in r["events"] if ts <= t}
                counts = pd.Series([owner[a] for a in seen if a in owner], dtype="int64").value_counts()
                if len(seen) >= 2 and len(counts) and counts.iloc[0] >= 2 and counts.iloc[0] / len(seen) >= 0.5:
                    detected[name][r["pattern_id"]] = t
        print(f"[seed {seed}]   replay step {t}: {time.time() - t_start:.0f}s", flush=True)
    return [{"seed": seed, "model": name, **M.time_to_detection(detected[name], rings)} for name in fitted]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("variant", nargs="?", default="HI-Small")
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--scenario", default="default", choices=list(SCENARIOS))
    ap.add_argument("--step-hours", type=int, default=6)
    ap.add_argument("--no-replay", action="store_true")
    ap.add_argument("--list-scenarios", action="store_true")
    args = ap.parse_args()
    if args.list_scenarios:
        print(json.dumps(SCENARIOS, indent=1))
        return

    tx, _ = load_with_index(args.variant)
    tx = primary_period(tx, args.variant)
    out = RESULTS / args.scenario
    out.mkdir(parents=True, exist_ok=True)
    parts: dict[str, list] = {}
    for seed in args.seeds:
        for key, df in run_seed(args.variant, seed, args.scenario, tx, args.step_hours, not args.no_replay).items():
            parts.setdefault(key, []).append(df)
    for key, dfs in parts.items():
        pd.concat(dfs, ignore_index=True).to_csv(out / f"{key}.csv", index=False)
    (out / "meta.json").write_text(json.dumps({"variant": args.variant, "seeds": args.seeds, "scenario": args.scenario,
                                              "inject": SCENARIOS[args.scenario], "step_hours": args.step_hours,
                                              "replay": not args.no_replay}, indent=1))
    from .report import write_report

    write_report()


if __name__ == "__main__":
    main()
