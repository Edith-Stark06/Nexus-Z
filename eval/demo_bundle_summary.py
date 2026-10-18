"""Pool the eval.demo_bundle_check JSON files into the tables used in eval/results/DEMO_BUNDLE.md.

Usage: python -m eval.demo_bundle_summary [48|full]
"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

RES = Path(__file__).parent / "results"
ANY = "all_any_in_ring (pig_eval's count)"  # key written by eval.demo_bundle_check


def load(history: str) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(RES.glob(f"demo_bundle_check_seed*_history{history}.json"))]


def ms(x):
    x = np.array(x, dtype=float)
    return f"{x.mean():.3f} ± {x.std(ddof=1):.3f}" if len(x) > 1 else f"{x.mean():.3f}"


def frac(a, b):
    return f"{a}/{b} = {a / b:.0%}" if b else "n/a"


def main(history: str) -> None:
    runs = load(history)
    print(f"history={history}; seeds {[r['seed'] for r in runs]}")
    for w in ("24", "48"):
        W = [r["windows"][w] for r in runs]
        print(f"\n## window {w} h")
        print("per seed: " + "; ".join(f"seed {r['seed']}: PR-AUC {x['pr_auc_injected']:.3f}, P {x['precision']:.3f}, R {x['recall']:.3f}, "
                                      f"flagged {x['flagged']}, injected active {x['injected_fraud_active']}" for r, x in zip(runs, W)))
        print(f"PR-AUC injected: {ms([x['pr_auc_injected'] for x in W])}  (chance {np.mean([x['chance'] for x in W]):.5f}); "
              f"precision {ms([x['precision'] for x in W])}; recall {ms([x['recall'] for x in W])}; flagged accounts per seed {[x['flagged'] for x in W]}")
        ours = sum(x["rings"]["recovered_ours"] for x in W)
        n_ours = sum(x["rings"]["true_rings_ours"] for x in W)
        pe = sum(x["rings"]["recovered_pig_eval"] for x in W)
        n_pe = sum(x["rings"]["in_scope_pig_eval"] for x in W)
        print(f"ring recovery, our definition (half of all the ring's accounts): {frac(ours, n_ours)}; per seed "
              f"{[f'{x['rings']['recovered_ours']}/{x['rings']['true_rings_ours']}' for x in W]}")
        print(f"ring recovery, pig_eval definition (half of the active accounts, at least 2): {frac(pe, n_pe)}; per seed "
              f"{[f'{x['rings']['recovered_pig_eval']}/{x['rings']['in_scope_pig_eval']}' for x in W]}")
        print(f"detected rings per seed {[x['rings']['detected'] for x in W]}; share with purity >= 0.5: {ms([x['rings']['pure_rings'] for x in W])}; "
              f"rings with an injected account {[x['rings']['rings_with_injected_account'] for x in W]}; top-10 with injected {sum(x['rings']['top10_with_injected'] for x in W)} of {10 * len(W)}")
        for key, label in (("by_shape_ours", "by shape, our definition"), ("by_shape_pig_eval", "by shape, pig_eval definition")):
            f, s = Counter(), Counter()
            for x in W:
                for k, v in x["rings"][key].items():
                    a, b = map(int, v.split("/"))
                    f[k] += a
                    s[k] += b
            print(f"{label}: " + ", ".join(f"{k} {f[k]}/{s[k]}" for k in sorted(s)))
        print(f"hubs in a detected ring (pig_eval's count, hub or its settlement account): {sum(x['hubs'][ANY] for x in W)} of {sum(r['hubs_injected'] for r in runs)}; "
              f"hub itself in a ring {sum(x['hubs']['hub_in_ring'] for x in W)}; settlement only {sum(x['hubs']['settlement_only_in_ring'] for x in W)}; "
              f"hub scored at/above the bundle threshold {sum(x['hubs']['hub_flagged'] for x in W)} of {sum(x['hubs']['active'] for x in W)} active hubs")
        by = {}
        for x in W:
            for t, g in x["hubs"]["by_type"].items():
                d = by.setdefault(t, Counter())
                for k, v in g.items():
                    d[k] += v
        print("by type (hubs, active, scored>=threshold, hub in ring, hub or settlement in ring):")
        for t in sorted(by):
            g = by[t]
            print(f"  {t:13} {g['hubs']:3} {g['active']:3}  flagged {g['flagged']:3}  hub_in_ring {g['hub_in_ring']:3}  any_in_ring {g['any_in_ring']:3}")
        adv = {}
        for x in W:
            for a, g in x["hubs"]["by_adversarial"].items():
                d = adv.setdefault(a, Counter())
                for k, v in g.items():
                    d[k] += v
        print("adversarial vs plain (active, flagged, hub in ring):", {a: dict(g) for a, g in sorted(adv.items())})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "48")
