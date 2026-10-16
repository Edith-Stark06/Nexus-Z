"""Stand-in generator: pig-butchering rings and legitimate look-alikes injected into IBM AML data.

This exists so the ML pipeline can be tested on the project's own typology before the data
workstream's generator lands. Keep the interface (a table of new transactions plus ground truth)
and it can be swapped out. It is written by the modelling side, so treat results from it with the
circularity caution in docs/ML_RESULTS.md: the same person designed the rings and the features.

Rings (fraud accounts are new accounts; victims are real background accounts):
  fan-in      victims pay 1 to 4 collectors, forwarded within minutes through 1 or 2 mule layers to cash-out
  dispersed   collectors forward straight to many mules, which forward to a few cash-outs
  slow        like fan-in, but money is held for hours before moving on
  chain       one collector, a chain of 3 to 5 mules, one cash-out, few victims
Legitimate look-alikes (new hub accounts, never labelled fraud):
  merchant    many customers pay all week, one batch to a bank each day
  payroll     a lump arrives, then 40 to 150 employees are paid within the hour
  landlord    a few tenants pay on rent day, the total moves on hours later
  charity     a burst of small donations, a lump transfer a day or two later

Deposits are not labelled laundering (the victim is not a fraud account); every hop from a collector
onward is, so collectors, mules and cash-outs are positives and victims are not. Amounts and channels
are drawn from the background data so a payment alone carries no tell.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

RING_KINDS = ["fan-in", "dispersed", "slow", "chain"]
HARD_KINDS = ["merchant", "payroll", "landlord", "charity"]


@dataclass
class Injected:
    tx: pd.DataFrame      # background plus injected transactions, sorted by time
    rings: list[dict]     # ground truth in the same shape as IBM patterns (accounts = fraud network only)
    hard: list[dict]      # legitimate look-alikes: hub accounts and the accounts they settle to


class _Builder:
    def __init__(self, tx: pd.DataFrame, rng: np.random.Generator):
        self.rng = rng
        self.rows: list[tuple] = []
        usd = tx.loc[tx["currency"].astype(str) == "US Dollar", "amount"].to_numpy()
        self.q = {p: float(np.quantile(usd, p)) for p in (0.05, 0.2, 0.4, 0.6, 0.9)}
        clean = tx.loc[tx["is_laundering"] == 0, "channel"].astype(str).value_counts(normalize=True)
        self.channels, self.channel_p = clean.index.to_numpy(), clean.to_numpy()
        self.accounts = np.asarray(pd.unique(pd.concat([tx["src"], tx["dst"]], ignore_index=True)), dtype=object)
        self.t0, self.t1 = tx["ts"].min(), tx["ts"].max()
        self.next_id = 0

    def new_account(self) -> str:
        self.next_id += 1
        return "ACC-F%05X" % self.next_id  # six hex digits starting with F, above any real IBM account id

    def amount(self, lo=0.4, hi=0.9) -> float:
        return round(float(self.rng.uniform(self.q[lo], self.q[hi])), 2)

    def channel(self) -> str:
        return str(self.rng.choice(self.channels, p=self.channel_p))

    def pay(self, ts, src, dst, amount, laundering=0) -> None:
        self.rows.append((ts, src, dst, amount, self.channel(), laundering))

    def victims(self, n: int) -> list[str]:
        return self.rng.choice(self.accounts, size=n, replace=False).tolist()

    def at(self, hours_from_start: float) -> pd.Timestamp:
        return self.t0 + pd.Timedelta(hours=float(hours_from_start))


def _ring(b: _Builder, rid: int, kind: str) -> dict:
    rng = b.rng
    span_h = (b.t1 - b.t0).total_seconds() / 3600
    hours = float(rng.uniform(12, 72))
    start = b.at(rng.uniform(0, max(span_h - hours - 6, 1)))
    n_vic = int(rng.integers(4, 13)) if kind == "chain" else int(rng.integers(6, 41))
    n_coll = 1 if kind == "chain" else int(rng.integers(1, 5))
    collectors = [b.new_account() for _ in range(n_coll)]
    if kind == "dispersed":
        layers = [[b.new_account() for _ in range(int(rng.integers(4, 9)))]]
    elif kind == "chain":
        layers = [[b.new_account()] for _ in range(int(rng.integers(3, 6)))]
    else:
        layers = [[b.new_account() for _ in range(int(rng.integers(1, 5)))] for _ in range(int(rng.integers(1, 3)))]
    cashouts = [b.new_account() for _ in range(int(rng.integers(1, 3)))]
    lo, hi = (60, 720) if kind == "slow" else (2, 30)  # minutes a middleman holds money

    def hold():
        return pd.Timedelta(minutes=float(rng.uniform(lo, hi)))

    events = []
    for v in b.victims(n_vic):
        for _ in range(int(rng.choice([1, 1, 2]))):
            t, c, amt = start + pd.Timedelta(hours=float(rng.uniform(0, hours))), collectors[int(rng.integers(n_coll))], b.amount()
            b.pay(t, v, c, amt, laundering=0)
            node, when, carried = c, t, amt
            for layer in layers + [cashouts]:  # collector -> each mule layer -> cash-out
                nxt = layer[int(rng.integers(len(layer)))]
                when, carried = when + hold(), round(carried * float(rng.uniform(0.8, 0.97)), 2)
                b.pay(when, node, nxt, carried, laundering=1)
                events += [(when, node), (when, nxt)]
                node = nxt
    network = collectors + [a for layer in layers for a in layer] + cashouts
    first = min(e[0] for e in events)
    return {"pattern_id": rid, "type": kind, "first_ts": first, "last_ts": max(e[0] for e in events),
            "n_tx": len(events) // 2, "accounts": set(network), "events": events,
            "collectors": collectors, "cashouts": cashouts}


def _hard(b: _Builder, rid: int, kind: str) -> dict:
    rng = b.rng
    days = max(int((b.t1 - b.t0).total_seconds() // 86400), 1)
    hub, bank = b.new_account(), b.new_account()
    if kind == "merchant":
        day_sums: dict[int, float] = {}
        for c in b.victims(int(rng.integers(30, 151))):
            for _ in range(int(rng.integers(1, 4))):
                t = b.at(rng.uniform(0, days * 24))
                amt = b.amount(0.05, 0.6)
                b.pay(t, c, hub, amt)
                day_sums[int((t - b.t0).days)] = day_sums.get(int((t - b.t0).days), 0.0) + amt
        for d, total in day_sums.items():
            b.pay(b.t0 + pd.Timedelta(days=d, hours=23), hub, bank, round(total * 0.98, 2))
    elif kind == "payroll":
        for d in sorted(rng.choice(np.arange(1, days), size=min(2, days - 1), replace=False)):
            day = b.t0 + pd.Timedelta(days=int(d), hours=8)
            staff = b.victims(int(rng.integers(40, 151)))
            pays = [b.amount(0.4, 0.9) for _ in staff]
            b.pay(day, bank, hub, round(sum(pays), 2))  # funding lump arrives, then goes straight out
            for e, a in zip(staff, pays):
                b.pay(day + pd.Timedelta(minutes=float(rng.uniform(5, 60))), hub, e, a)
    elif kind == "landlord":
        day = b.t0 + pd.Timedelta(days=int(rng.integers(0, days)), hours=6)
        total = 0.0
        for tnt in b.victims(int(rng.integers(3, 13))):
            amt = b.amount(0.6, 0.9)
            total += amt
            b.pay(day + pd.Timedelta(hours=float(rng.uniform(0, 16))), tnt, hub, amt)
        b.pay(day + pd.Timedelta(hours=float(rng.uniform(18, 22))), hub, bank, round(total, 2))
    else:  # charity
        day = b.t0 + pd.Timedelta(days=int(rng.integers(0, max(days - 2, 1))), hours=9)
        total = 0.0
        for d in b.victims(int(rng.integers(30, 201))):
            amt = b.amount(0.05, 0.4)
            total += amt
            b.pay(day + pd.Timedelta(hours=float(rng.uniform(0, 6))), d, hub, amt)
        b.pay(day + pd.Timedelta(hours=float(rng.uniform(24, 48))), hub, bank, round(total, 2))
    return {"pattern_id": rid, "type": kind, "accounts": {hub, bank}, "hub": hub}


def inject(tx: pd.DataFrame, n_rings: int = 90, n_hard: int = 90, seed: int = 0) -> Injected:
    """Add rings and look-alikes to `tx` (primary period, in the loader's column format)."""
    b = _Builder(tx, np.random.default_rng(seed))
    rings = [_ring(b, i, RING_KINDS[i % len(RING_KINDS)]) for i in range(n_rings)]
    hard = [_hard(b, i, HARD_KINDS[i % len(HARD_KINDS)]) for i in range(n_hard)]
    new = pd.DataFrame(b.rows, columns=["ts", "src", "dst", "amount", "channel", "is_laundering"])
    new["currency"], new["receiving_currency"], new["amount_received"] = "US Dollar", "US Dollar", new["amount"]
    new["is_laundering"] = new["is_laundering"].astype("int8")
    new = new[(new["ts"] >= b.t0) & (new["ts"] <= b.t1)]  # keep every injected row inside the dataset's period
    merged = pd.concat([tx.drop(columns="tx_id"), new[tx.drop(columns="tx_id").columns]], ignore_index=True)
    merged = merged.sort_values("ts", kind="stable", ignore_index=True)
    merged.insert(0, "tx_id", merged.index.astype("int64"))
    return Injected(merged, rings, hard)
