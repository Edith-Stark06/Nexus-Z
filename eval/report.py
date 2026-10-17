"""Turn the raw CSVs in eval/results/<scenario>/ into eval/results/RESULTS.md.

Every number is mean +- standard deviation over the seeds in the run. A difference between two feature
sets is called "inside the noise" when the mean of the paired per-seed differences is smaller than their
standard deviation (a rough rule: with only a few seeds there is no sound significance test).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

RESULTS = Path(__file__).parent / "results"
CANON = ["transaction-only", "+ behavioral", "+ graph", "+ k-core, clustering, components", "+ bursts and motifs"]


def order_of(r: dict) -> list:
    """The feature sets present in a results folder, in ablation order (older runs have four, newer five)."""
    present = set(r["account"]["model"])
    return [m for m in CANON if m in present]


def ms(x: pd.Series, digits: int = 3) -> str:
    x = x.dropna()
    if not len(x):
        return "n/a"
    return f"{x.mean():.{digits}f} ± {x.std(ddof=1) if len(x) > 1 else 0.0:.{digits}f}"


def noise(a: pd.Series, b: pd.Series) -> str:
    d = b.to_numpy() - a.to_numpy()
    d = d[~np.isnan(d)]
    if len(d) < 2:
        return "n/a (one seed)"
    verdict = "inside the noise" if abs(d.mean()) <= d.std(ddof=1) else "outside the noise"
    return f"{d.mean():+.3f} ± {d.std(ddof=1):.3f}, {verdict}"


def table(df: pd.DataFrame) -> str:
    return "| " + " | ".join(df.columns) + " |\n|" + "---|" * len(df.columns) + "\n" + "\n".join(
        "| " + " | ".join(str(v) for v in row) + " |" for row in df.to_numpy())


def load(scenario: str) -> dict:
    d = RESULTS / scenario
    out = {p.stem: pd.read_csv(p) for p in d.glob("*.csv") if p.stat().st_size > 2}
    out["meta"] = json.loads((d / "meta.json").read_text())
    return out


def account_section(r: dict) -> str:
    ORDER = order_of(r)
    a, rows, diffs = r["account"], [], []
    for scope in ("all candidates", "new accounts only", "all labels (IBM + injected)"):
        sub = a[a["scope"] == scope]
        for m in ORDER:
            s = sub[sub["model"] == m]
            rows.append({"scope": scope, "features": m, "positives": f"{s['positives'].mean():.0f}",
                         "PR-AUC": ms(s["pr_auc"]), "precision": ms(s["precision"]), "recall": ms(s["recall"]), "F1": ms(s["f1"])})
    sub = a[a["scope"] == "all candidates"].pivot(index="seed", columns="model", values="pr_auc")
    for prev, cur in zip(ORDER, ORDER[1:]):
        diffs.append(f"- {cur} vs {prev}: PR-AUC {noise(sub[prev], sub[cur])}")
    diffs.append(f"- full graph set vs transaction-only: PR-AUC {noise(sub[ORDER[0]], sub[ORDER[-1]])}")
    return table(pd.DataFrame(rows)) + "\n\nPaired per-seed differences (injected fraud accounts, all candidates):\n\n" + "\n".join(diffs)


def ring_section(r: dict) -> str:
    ORDER = order_of(r)
    g = r["rings"]
    g = g[(g["split"] == "test") & g["chosen_on_val"]]
    kinds = [c for c in g.columns if c.startswith("rec_")]
    rows = []
    for m in ORDER:
        s = g[g["model"] == m]
        rows.append({"features": m, "flagged fraction (chosen on val)": ", ".join(f"{t:g}" for t in sorted(s["top"].unique())),
                     "true rings": f"{s['true_rings'].mean():.1f}", "recovery": ms(s["recovery"]), "pure rings": ms(s["pure_rings"]),
                     "detected rings": f"{s['detected_rings'].mean():.0f}", "hub rings": f"{s['hub_rings'].mean():.1f}"})
    by_kind = pd.DataFrame([{"features": m, **{k[4:]: ms(g[g["model"] == m][k], 2) for k in kinds}} for m in ORDER])
    return table(pd.DataFrame(rows)) + "\n\nRecovery by ring shape (test):\n\n" + table(by_kind)


def hub_section(r: dict) -> str:
    ORDER = order_of(r)
    h = r["hubs"]
    if h.empty:
        return "No look-alike hub was active in the test window."
    rows = []
    for m in ORDER:
        s = h[h["model"] == m]
        row = {"features": m, "all hubs": f"{s['flagged'].mean():.2f} ({len(s) // max(s['seed'].nunique(), 1)}/seed)"}
        for adv in (False, True):
            t = s[s["adversarial"] == adv]
            row["adversarial" if adv else "plain"] = f"{t['flagged'].mean():.2f}" if len(t) else "n/a"
        for kind in sorted(s["type"].unique()):
            row[kind] = f"{s[s['type'] == kind]['flagged'].mean():.2f}"
        rows.append(row)
    return "Share of active look-alike hubs flagged at the validation threshold (lower is better):\n\n" + table(pd.DataFrame(rows))


def detection_section(r: dict) -> str:
    ORDER = order_of(r)
    d = r.get("detection")
    if d is None or d.empty:
        return "Not run."
    rows = [{"features": m, "rings": f"{d[d['model'] == m]['rings'].mean():.1f}", "detected": ms(d[d["model"] == m]["detected_share"]),
             "median hours": ms(d[d["model"] == m]["median_hours"], 1), "p90 hours": ms(d[d["model"] == m]["p90_hours"], 1),
             "caught before last payment": ms(d[d["model"] == m]["caught_before_last_payment"])} for m in ORDER]
    return table(pd.DataFrame(rows))


def robustness_section(scenarios: list) -> str:
    rows = []
    for sc in scenarios:
        r = load(sc)
        a = r["account"]
        a = a[a["scope"] == "all candidates"]
        g = r["rings"]
        g = g[(g["split"] == "test") & g["chosen_on_val"]]
        h = r["hubs"]
        order = order_of(r)
        for m in (order[0], order[-1]):
            s, t = a[a["model"] == m], g[g["model"] == m]
            rows.append({"scenario": sc, "features": m, "PR-AUC": ms(s["pr_auc"]), "recall": ms(s["recall"]),
                         "ring recovery": ms(t["recovery"]),
                         "hubs flagged": f"{h[h['model'] == m]['flagged'].mean():.2f}" if len(h) else "n/a",
                         "seeds": len(r["meta"]["seeds"])})
    return table(pd.DataFrame(rows))


def write_report() -> Path:
    from .run import SCENARIOS

    scenarios = sorted(p.name for p in RESULTS.iterdir() if p.is_dir() and (p / "meta.json").exists())
    if "default" not in scenarios:
        raise SystemExit("run the default scenario first")
    r = load("default")
    meta = r["meta"]
    text = f"""# Independent evaluation results

Generated by `python -m eval.run` (see eval/run.py). **All data here is synthetic where it matters**: the background is the IBM
AML {meta['variant']} data; the pig-butchering rings and the legitimate look-alikes are injected by `data/rings.py`, which we wrote.
Account open dates in the contract export are also synthetic. Numbers are mean ± standard deviation over seeds {meta['seeds']}
(each seed is a different set of rings and look-alikes), measured on the test window after thresholds were chosen on validation.

## What the labels mean

- **Injected fraud account**: a collector, mule or cash-out of an injected ring with at least one laundering payment in the window.
  Victims are not fraud accounts. IBM's own laundering accounts are left out of the injected ranking (they are shown in the
  "all labels" row).
- **Ring recovery**: a true ring counts as recovered when one detected ring holds at least half of its fraud accounts.
- **Hub flagged**: a legitimate look-alike hub scored at or above the threshold that gave the best F1 on validation.
- The score threshold and the flagged fraction are chosen on validation only.

## Ablation: account level (default scenario)

{account_section(r)}

## Ring level (default scenario, test window)

{ring_section(r)}

## Hard negatives: legitimate look-alikes (default scenario)

{hub_section(r)}

## Time to detection (default scenario)

The test window is replayed in {meta['step_hours']}-hour steps; at each step features, scores and rings use only data up to that step.

{detection_section(r)}

## Robustness: other ring and look-alike mixes

{robustness_section(scenarios)}

Scenario definitions: `{json.dumps(SCENARIOS)}`

## Caveats

- Rings and features were both designed by us. The generator is more varied than the earlier stand-in
  (`ml/standin_rings.py`) but is still an author's idea of pig-butchering, not observed fraud.
- Few rings fall in the test window per seed, so ring-level numbers move a lot between seeds; read the ± before the mean.
- The IBM data has no account age, mixed currencies and an ACH tell on its own laundering rows; injected payments avoid the tell.
"""
    path = RESULTS / "RESULTS.md"
    path.write_text(text, encoding="utf-8")
    print(f"wrote {path}")
    return path


if __name__ == "__main__":
    write_report()
