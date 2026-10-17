"""Export an Injected result as the team data contract (docs/TEAM_SPLIT.md section 3).

Usage (from the repo root):  python -m data.export HI-Small [seed] [out_dir]

Files (pseudonymized ids only, never committed):
  transactions.csv  tx_id, ts (UTC ISO 8601), src, dst, amount, channel
  accounts.csv      account_id, opened_at
  labels.csv        account_id, is_fraud, ring_id, role, legit_hub_type
                    role is victim, collector, mule, cashout or none. legit_hub_type (merchant, payroll,
                    landlord, charity, new-customer) marks the legitimate look-alikes and their settlement
                    accounts. IT MUST NEVER BE A MODEL FEATURE: it exists to score false positives.
  links.csv         account_a, account_b, link_type (device, ip or beneficiary)

is_fraud is 1 for any account that sends or receives a laundering transaction, so it includes laundering
accounts that are already in the IBM data. Those have no ring_id (the IBM patterns file is not mapped here).
A victim has is_fraud 0 unless it is also one of IBM's own laundering accounts (victims are sampled from all
background accounts; on HI-Small seed 0 that is 13 of 1,451). `export` reports that count as
victims_also_ibm_laundering. An account in two rings keeps the first ring it was seen in.

Account open dates: IBM has none, so they are generated here (seeded) and are SYNTHETIC. They are built so
that age alone does not give the label away; `age_leak_check` measures how well age alone ranks fraud.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .rings import Injected

ACCOUNT_AGE_DAYS = {  # (mixture weight, low, high) of the account's age, in days, when first seen in the data
    "background": [(0.12, 0, 14), (0.38, 14, 365), (0.50, 365, 4000)],
    "fraud-new": [(1.0, 0, 14)],
    "fraud-aged": [(0.2, 14, 365), (0.8, 365, 3000)],
    "hub-new": [(1.0, 0, 21)],
    "hub-aged": [(0.3, 30, 365), (0.7, 365, 4000)],
}


def _draw_age(rng: np.random.Generator, kind: str, n: int) -> np.ndarray:
    parts = ACCOUNT_AGE_DAYS[kind]
    choice = rng.choice(len(parts), size=n, p=[p[0] for p in parts])
    lo = np.array([parts[c][1] for c in choice], dtype=float)
    hi = np.array([parts[c][2] for c in choice], dtype=float)
    return lo + (hi - lo) * rng.random(n)


def first_seen(tx: pd.DataFrame) -> pd.Series:
    first = pd.concat([tx.groupby("src", observed=True)["ts"].min(), tx.groupby("dst", observed=True)["ts"].min()])
    return first.groupby(level=0).min()


def build_labels(inj: Injected) -> pd.DataFrame:
    tx = inj.tx
    bad = tx[tx["is_laundering"] == 1]
    fraud = set(bad["src"].astype(str)) | set(bad["dst"].astype(str))
    accounts = pd.Index(pd.unique(pd.concat([tx["src"], tx["dst"]], ignore_index=True)).astype(str))
    lab = pd.DataFrame({"account_id": accounts, "is_fraud": accounts.isin(fraud).astype("int8"),
                        "ring_id": "", "role": "none", "legit_hub_type": ""}).set_index("account_id")
    for r in inj.rings:
        rid = "RNG-%04d" % r["pattern_id"]
        for role, members in (("victim", r["victims"]), ("collector", r["collectors"]), ("mule", r["mules"]),
                              ("cashout", r["cashouts"])):
            for a in members:
                if a in lab.index and lab.at[a, "ring_id"] == "":
                    lab.at[a, "ring_id"], lab.at[a, "role"] = rid, role
    for h in inj.hard:
        for a in h["accounts"]:
            if a in lab.index:
                lab.at[a, "legit_hub_type"] = h["type"]
    return lab.reset_index()


def build_open_dates(inj: Injected, seed: int = 0) -> pd.DataFrame:
    """Synthetic open dates: age at first appearance. Fraud rings and hubs are a mix of new and aged."""
    rng = np.random.default_rng([seed, 9])
    first = first_seen(inj.tx)
    kind = pd.Series("background", index=first.index, dtype=object)
    for r in inj.rings:
        for a in r["accounts"]:
            if a in kind.index:
                kind[a] = "fraud-aged" if r["aged"] else "fraud-new"
    for h in inj.hard:
        for a in h["accounts"]:
            if a in kind.index:
                kind[a] = "hub-aged" if h["aged"] else "hub-new"
    age = np.zeros(len(first))
    for k in kind.unique():
        m = (kind == k).to_numpy()
        age[m] = _draw_age(rng, k, int(m.sum()))
    opened = first - pd.to_timedelta(age, unit="D")
    return pd.DataFrame({"account_id": first.index.astype(str), "opened_at": opened.dt.floor("D").to_numpy()})


def build_links(inj: Injected, seed: int = 0) -> pd.DataFrame:
    """Shared device / ip / beneficiary links. Some rings share infrastructure; so do ordinary accounts."""
    rng = np.random.default_rng([seed, 10])
    rows = []
    kinds = ["device", "ip", "beneficiary"]

    def link_group(accounts, p):
        accounts = list(accounts)
        for i in range(1, len(accounts)):
            if rng.random() < p:
                rows.append((accounts[int(rng.integers(0, i))], accounts[i], str(rng.choice(kinds))))

    for r in inj.rings:
        if rng.random() < 0.6:
            link_group(r["collectors"] + r["mules"] + r["cashouts"], 0.5)
    for h in inj.hard:
        if h["type"] in ("merchant", "payroll") and rng.random() < 0.6:
            link_group(sorted(h["accounts"]), 1.0)
    background = inj.tx["src"].drop_duplicates().sample(min(400, inj.tx["src"].nunique()), random_state=seed).astype(str).tolist()
    for _ in range(max(len(rows) // 2, 20)):  # ordinary shared devices / networks (households, offices)
        a, b = rng.choice(len(background), size=2, replace=False)
        rows.append((background[a], background[b], str(rng.choice(kinds))))
    return pd.DataFrame(rows, columns=["account_a", "account_b", "link_type"])


def age_leak_check(inj: Injected, seed: int = 0) -> dict:
    """How well does account age at first sight rank fraud accounts? 0.5 means not at all."""
    opened = build_open_dates(inj, seed).set_index("account_id")["opened_at"]
    first = first_seen(inj.tx)
    first.index = first.index.astype(str)
    age = (first.reindex(opened.index) - opened).dt.days.to_numpy()
    labels = build_labels(inj).set_index("account_id").reindex(opened.index)
    y = labels["is_fraud"].to_numpy() == 1
    rank = pd.Series(-age).rank().to_numpy()  # younger ranks higher
    auc = (rank[y].sum() - y.sum() * (y.sum() + 1) / 2) / (y.sum() * (~y).sum())
    injected = labels["ring_id"].ne("").to_numpy() & y
    return {"auc_younger_is_fraud_all": float(auc), "fraud_accounts": int(y.sum()),
            "injected_fraud_accounts": int(injected.sum()),
            "median_age_days_fraud": float(np.median(age[y])), "median_age_days_other": float(np.median(age[~y]))}


def export(inj: Injected, out_dir: Path, seed: int = 0) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    tx = inj.tx
    contract = pd.DataFrame({"tx_id": tx["tx_id"], "ts": tx["ts"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                             "src": tx["src"].astype(str), "dst": tx["dst"].astype(str),
                             "amount": tx["amount"], "channel": tx["channel"].astype(str)})
    contract.to_csv(out_dir / "transactions.csv", index=False)
    opened = build_open_dates(inj, seed)
    opened.assign(opened_at=opened["opened_at"].dt.strftime("%Y-%m-%d")).to_csv(out_dir / "accounts.csv", index=False)
    labels = build_labels(inj)
    labels.to_csv(out_dir / "labels.csv", index=False)
    links = build_links(inj, seed)
    links.to_csv(out_dir / "links.csv", index=False)
    victims = labels[labels["role"] == "victim"]
    return {"transactions": len(contract), "accounts": len(opened), "fraud_accounts": int(labels["is_fraud"].sum()),
            "victims": len(victims), "victims_also_ibm_laundering": int(victims["is_fraud"].sum()),
            "links": len(links), "age_leak": age_leak_check(inj, seed)}


if __name__ == "__main__":
    from data.ibm_aml import load_with_index, primary_period

    variant = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("data_export") / f"{variant}-seed{seed}"
    from .rings import inject

    base, _ = load_with_index(variant)
    print(export(inject(primary_period(base, variant), seed=seed), out, seed))
