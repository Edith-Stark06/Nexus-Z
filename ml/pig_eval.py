"""How many injected pig-butchering rings does a saved model find, and how many look-alikes does it wrongly flag?

Usage (from the repo root):  python -m ml.pig_eval HI-Small <bundle folder> <inject seed> [hours]

Rebuilds the data a demo slice is made from (the variant's primary period plus rings and look-alikes from
data/rings.py with the given seed), keeps the last `hours` (default 48), and scores it the way the API does:
once with the last 24 hours as the active window, once with all `hours`. A ring counts as recovered when one
detected ring holds at least half of its fraud accounts that are active in the window, and at least two.
Use a seed the bundle was NOT trained with to see how it does on rings it has never seen.
Everything injected is synthetic, and written by the team that wrote the features, so read it as an upper bound.
"""
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

from data.ibm_aml import PRIMARY_DAYS, load_transactions, primary_period
from data.rings import inject

from .bundle import load_bundle
from .service import Scorer


def run(variant: str, bundle_dir: Path, seed: int, hours: int = 48) -> None:
    bundle = load_bundle(bundle_dir)
    tx = primary_period(load_transactions(variant), variant)
    inj = inject(tx, seed=seed)
    end = inj.tx["ts"].min().normalize() + pd.Timedelta(days=PRIMARY_DAYS[variant.split("-")[1]])
    data = inj.tx[(inj.tx["ts"] >= end - pd.Timedelta(hours=hours)) & (inj.tx["ts"] < end)].reset_index(drop=True)
    fraud = {a for r in inj.rings for a in r["accounts"]}
    print(f"{variant} + {len(inj.rings)} rings and {len(inj.hard)} look-alikes (seed {seed}); last {hours} h: {len(data):,} payments; "
          f"bundle trained with injected seed {bundle.meta.get('injected_rings_seed')}", flush=True)
    now = data["ts"].max()
    for window in (24, hours):
        scorer = Scorer.from_transactions(bundle, data, active_since=now - pd.Timedelta(hours=window))
        owner = {a: i for i, r in enumerate(scorer.rings) for a in r.members}
        active = set(scorer.scores.index)
        seen, found = Counter(), Counter()
        for ring in inj.rings:
            accounts = [a for a in ring["accounts"] if a in active]
            if len(accounts) < 2:
                continue
            kind = ring.get("kind", ring.get("type", "?"))
            seen[kind] += 1
            top = pd.Series([owner[a] for a in accounts if a in owner]).value_counts()
            if len(top) and top.iloc[0] >= 2 and top.iloc[0] / len(accounts) >= 0.5:
                found[kind] += 1
        hubs = sum(any(a in owner for a in h["accounts"]) for h in inj.hard)
        by_risk = sorted(scorer.rings, key=lambda r: r.risk, reverse=True)[:10]
        n_seen, n_found = sum(seen.values()), sum(found.values())
        print(f"\nactive window {window} h: {len(scorer.rings)} rings detected. Injected rings with at least 2 active fraud accounts: "
              f"{n_seen}; recovered {n_found} ({n_found / max(n_seen, 1):.0%}).")
        print("  by shape:", {k: f"{found[k]}/{seen[k]}" for k in sorted(seen)})
        print(f"  look-alike hubs inside a detected ring: {hubs} of {len(inj.hard)}")
        print(f"  of the 10 riskiest rings, {sum(any(m in fraud for m in r.members) for r in by_risk)} contain injected fraud accounts")


if __name__ == "__main__":
    run(sys.argv[1], Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 48)
