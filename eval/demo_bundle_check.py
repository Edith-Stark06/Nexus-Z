"""Score the demo bundle's output with eval/metrics.py (independent of ml.pig_eval).

Usage (from the repo root):
    python -m eval.demo_bundle_check HI-Small ml/artifacts/HI-Small-pig <seed> [--history 48|full]

It rebuilds the data the way ml.pig_eval does (primary period + data.rings.inject with the given seed, last 48 hours),
scores it with ml.service.Scorer (the public class the API uses; nothing in ml/ is changed), and then measures the output
with our own definitions:
  account level   PR-AUC of the account risk for injected fraud accounts that take part in a laundering payment in the
                  window (IBM's own laundering accounts are left out of the ranking, as in eval.run), plus precision and
                  recall at the bundle's own validation-chosen threshold
  ring level      recovery as in eval/metrics.py (a detected ring holds at least half of ALL the ring's fraud accounts),
                  also ml.pig_eval's looser definition recomputed here so the two can be compared, purity, hub rings
  look-alikes     for each hub type: share of active hubs scored at or above the threshold, share inside a detected ring
--history 48   features from the last 48 hours only (what ml.pig_eval and the API do)
--history full features from every payment up to the end of the period (what the model was trained with, ml/PROTOCOL.md)
Everything injected is synthetic.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from data.ibm_aml import PRIMARY_DAYS, load_transactions, primary_period
from data.rings import inject
from ml.bundle import load_bundle
from ml.service import Scorer

from . import metrics as M


def run(variant: str, bundle_dir: Path, seed: int, history: str = "48", hours: int = 48, options: dict | None = None) -> dict:
    bundle = load_bundle(bundle_dir)
    tx = primary_period(load_transactions(variant), variant)
    inj = inject(tx, seed=seed, **(options or {}))
    end = inj.tx["ts"].min().normalize() + pd.Timedelta(days=PRIMARY_DAYS[variant.split("-")[1]])
    last = inj.tx[(inj.tx["ts"] >= end - pd.Timedelta(hours=hours)) & (inj.tx["ts"] < end)].reset_index(drop=True)
    seen_tx = last if history == "48" else inj.tx[inj.tx["ts"] < end].reset_index(drop=True)
    now = last["ts"].max()
    network = {a for r in inj.rings for a in r["accounts"]}
    thr = float(bundle.threshold)
    out = {"seed": seed, "history": history, "inject_options": options or "default", "variant": variant, "bundle": str(bundle_dir), "threshold": thr,
           "rings_injected": len(inj.rings), "hubs_injected": len(inj.hard), "windows": {}}

    for window in (24, hours):
        lo = now - pd.Timedelta(hours=window)
        scorer = Scorer.from_transactions(bundle, seen_tx, active_since=lo)
        s = scorer.scores
        idx = s.index
        detected = [r.members for r in scorer.rings]
        owner = {a: i for i, m in enumerate(detected) for a in m}
        inside = last[last["ts"] > lo]
        laundering = inside[inside["is_laundering"] == 1]
        bad = set(laundering["src"]) | set(laundering["dst"])

        y = idx.isin(list(network & bad))
        keep = ~idx.isin(list(bad - network))
        score = s.to_numpy()
        res = {"candidates": int(len(idx)), "injected_fraud_active": int(y.sum()),
               "pr_auc_injected": M.average_precision(y[keep], score[keep]),
               "chance": float(y[keep].mean()),
               **{k: v for k, v in M.precision_recall_f1(y[keep], score[keep], thr).items()}}
        res["pr_auc_all_labels"] = M.average_precision(idx.isin(list(bad)), score)

        # ring recovery: our definition (all of a ring's fraud accounts) and ml.pig_eval's (only those active in the window)
        truth = M.active_rings(inj.rings, (lo, now))
        ours = M.ring_recovery(detected, truth)
        active = set(idx)
        loose_seen = loose_found = 0
        by_kind_ours, by_kind_loose = Counter(), Counter()
        seen_kind = Counter()
        for r in inj.rings:
            acc = [a for a in r["accounts"] if a in active]
            if len(acc) < 2:
                continue
            loose_seen += 1
            seen_kind[r["type"]] += 1
            top = pd.Series([owner[a] for a in acc if a in owner], dtype="int64").value_counts()
            if len(top) and top.iloc[0] >= 2 and top.iloc[0] / len(acc) >= 0.5:
                loose_found += 1
                by_kind_loose[r["type"]] += 1
        for r in truth:
            c = Counter(owner[a] for a in r["accounts"] if a in owner)
            if c and max(c.values()) / len(r["accounts"]) >= 0.5:
                by_kind_ours[r["type"]] += 1
        truth_kind = Counter(r["type"] for r in truth)
        pure = M.ring_purity(detected, bad)
        top10 = sorted(scorer.rings, key=lambda r: r.risk, reverse=True)[:10]
        res["rings"] = {"detected": len(detected), "true_rings_ours": len(truth), "recovered_ours": int(round(ours["recovery"] * len(truth))),
                        "recovery_ours": ours["recovery"], "mean_cover_ours": ours["mean_cover"],
                        "in_scope_pig_eval": loose_seen, "recovered_pig_eval": loose_found,
                        "pure_rings": float((pure >= 0.5).mean()) if len(pure) else 0.0,
                        "rings_with_injected_account": int(sum(any(a in network for a in m) for m in detected)),
                        "top10_with_injected": int(sum(any(m in network for m in r.members) for r in top10)),
                        "by_shape_ours": {k: f"{by_kind_ours[k]}/{truth_kind[k]}" for k in sorted(truth_kind)},
                        "by_shape_pig_eval": {k: f"{by_kind_loose[k]}/{seen_kind[k]}" for k in sorted(seen_kind)}}

        # look-alike hubs, by type
        hubs = {a for h in inj.hard for a in h["accounts"]}
        res["hub_rings"] = M.hub_rings(detected, hubs)
        rows = []
        for h in inj.hard:
            hub, settle = h["hub"], [a for a in h["accounts"] if a != h["hub"]]
            rows.append({"type": h["type"], "adversarial": bool(h["adversarial"]), "active": hub in active,
                         "hub_flagged": bool(hub in active and s[hub] >= thr), "hub_in_ring": hub in owner,
                         "any_in_ring": any(a in owner for a in h["accounts"]),
                         "settlement_in_ring": any(a in owner for a in settle)})
        hf = pd.DataFrame(rows)
        res["hubs"] = {
            "all_any_in_ring (pig_eval's count)": int(hf["any_in_ring"].sum()), "hub_in_ring": int(hf["hub_in_ring"].sum()),
            "settlement_only_in_ring": int((hf["any_in_ring"] & ~hf["hub_in_ring"]).sum()),
            "active": int(hf["active"].sum()), "hub_flagged": int(hf["hub_flagged"].sum()),
            "by_type": {t: {"hubs": int(len(g)), "active": int(g["active"].sum()), "flagged": int(g["hub_flagged"].sum()),
                            "hub_in_ring": int(g["hub_in_ring"].sum()), "any_in_ring": int(g["any_in_ring"].sum())}
                        for t, g in hf.groupby("type")},
            "by_adversarial": {str(a): {"active": int(g["active"].sum()), "flagged": int(g["hub_flagged"].sum()),
                                        "hub_in_ring": int(g["hub_in_ring"].sum())} for a, g in hf.groupby("adversarial")}}
        out["windows"][str(window)] = res
        print(f"[seed {seed} history {history}] window {window} h done", flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("variant")
    ap.add_argument("bundle", type=Path)
    ap.add_argument("seed", type=int)
    ap.add_argument("--history", choices=["48", "full"], default="48")
    ap.add_argument("--hard-kinds", nargs="+", default=None, help="inject only these look-alike types (data.rings option; default all)")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    options = {"hard_kinds": a.hard_kinds} if a.hard_kinds else None
    res = run(a.variant, a.bundle, a.seed, a.history, options=options)
    tag = ("_" + "-".join(a.hard_kinds)) if a.hard_kinds else ""
    path = a.out or Path(__file__).parent / "results" / f"demo_bundle_check_seed{a.seed}_history{a.history}{tag}.json"
    path.write_text(json.dumps(res, indent=1, default=float), encoding="utf-8")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
