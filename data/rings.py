"""Pig-butchering ring generator and legitimate look-alikes, injected into IBM AML background traffic.

This replaces the stand-in in ml/standin_rings.py (same interface: RING_KINDS, inject, Injected).
Everything here is synthetic and labelled as such. Design goals, in order:

1. No payment-level tells. Currency, amount scale and channel of every injected payment are drawn
   from the clean background distribution. Ring money moves in the ring's own currency, scaled by the
   currency's median so amounts look like real background amounts.
2. Timing that does not collapse to "money leaves within minutes". Rings differ in how long a
   middleman holds money (minutes, hours, days), whether it forwards each payment, a batch, or a split
   across several accounts, and one ring can mix all of these.
3. Account age is not a label. Some fraud rings use accounts with earlier ordinary activity; some
   legitimate hubs and ordinary customers are brand new.
4. Legitimate look-alikes that really look like rings, including adversarial versions that pass money
   through quickly.

Ring shapes (fraud accounts are new ids; victims are real background accounts):
  fan-in     victims -> 1 to 4 collectors -> 1 or 2 mule layers -> cash-out, forwarded within minutes
  dispersed  collectors forward to many mules in one wide layer, then to a few cash-outs
  chain      one collector, a chain of 3 to 5 single mules, one cash-out, few victims
  batched    middlemen hold money and forward it in batches every few hours
  delayed    middlemen hold money for hours to days before moving it
  split      each payment is split across several next accounts
  mixed      every layer picks its own speed and its own forwarding mode
  aged       like mixed, but the network accounts already have ordinary history
Legitimate look-alikes (never fraud), half of them adversarial:
  merchant       customers pay all week; settlement to a bank daily (adversarial: hourly, within minutes)
  payroll        a funding lump arrives, then 40 to 150 employees are paid (adversarial: within minutes)
  landlord       tenants pay on rent day; the total moves on hours later (adversarial: forwarded per payment)
  charity        a burst of small donations, then a lump transfer (adversarial: a few hours later)
  new-customer   a brand-new ordinary account that is paid, then spends quickly

Labels: a victim's deposit is NOT laundering (the victim is not a fraud account). Every hop from a
collector onward is laundering (1). Hub accounts and new customers are never fraud.
Same seed, same output.
"""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

RING_KINDS = ["fan-in", "dispersed", "chain", "batched", "delayed", "split", "mixed", "aged"]
HARD_KINDS = ["merchant", "payroll", "landlord", "charity", "new-customer"]

HOLD_MINUTES = {"fast": (2, 30), "medium": (60, 360), "slow": (360, 2880)}
NEW_ID_BASE = 0xF00000  # real IBM ids are ACC-000000 up to well below this; injected ids are ACC-Fxxxxx


@dataclass
class Injected:
    tx: pd.DataFrame        # background plus injected transactions, sorted by time, loader's column format
    rings: list[dict]       # ground truth in the shape of IBM patterns; `accounts` is the fraud network only
    hard: list[dict]        # legitimate look-alikes: type, accounts (hub and settlement ids), hub, adversarial
    params: dict = field(default_factory=dict)


class _Pool:
    """Background statistics that every injected payment is drawn from."""

    def __init__(self, tx: pd.DataFrame, rng: np.random.Generator, max_sample: int = 300_000):
        currency = tx["currency"].astype(str)
        clean = (tx["is_laundering"] == 0).to_numpy()
        self.median = tx.assign(c=currency).groupby("c")["amount"].median().to_dict()
        n = int(clean.sum())
        pick = rng.choice(np.flatnonzero(clean), size=min(max_sample, n), replace=False)
        sample = tx.iloc[pick]
        sc = sample["currency"].astype(str).to_numpy()
        z = sample["amount"].to_numpy(dtype=float) / np.array([self.median[c] for c in sc])
        self.z = np.sort(z[np.isfinite(z) & (z > 0)])
        ccy = pd.Series(sc).value_counts(normalize=True)
        self.currencies, self.currency_p = ccy.index.to_numpy(), ccy.to_numpy()
        ch = sample["channel"].astype(str).value_counts(normalize=True)
        self.channels, self.channel_p = ch.index.to_numpy(), ch.to_numpy()

        first = pd.concat([tx.groupby("src", observed=True)["ts"].min(), tx.groupby("dst", observed=True)["ts"].min()])
        first = first.groupby(level=0).min().sort_values(kind="stable")
        self.accounts = first.index.to_numpy(dtype=object)
        self.first_seen = first.to_numpy()
        self.t0, self.t1 = tx["ts"].min(), tx["ts"].max()
        self.span_h = (self.t1 - self.t0).total_seconds() / 3600


class _Ids:
    def __init__(self):
        self.n = 0

    def new(self) -> str:
        self.n += 1
        return "ACC-%06X" % (NEW_ID_BASE + self.n)


class _Rows:
    """Collects injected payments for one ring or hub, tagged with the ring's currency."""

    def __init__(self, pool: _Pool, rng: np.random.Generator, currency: str | None = None):
        self.pool, self.rng, self.rows = pool, rng, []
        self.currency = currency or str(rng.choice(pool.currencies, p=pool.currency_p))

    def z(self, qlo: float, qhi: float) -> float:
        n = len(self.pool.z)
        return float(self.pool.z[int(self.rng.integers(int(qlo * n), max(int(qhi * n), int(qlo * n) + 1)))])

    def amount(self, qlo: float, qhi: float) -> float:
        return max(round(self.z(qlo, qhi) * self.pool.median[self.currency], 2), 0.01)

    def pay(self, ts, src: str, dst: str, amount: float, laundering: int = 0) -> None:
        ts = pd.Timestamp(ts).floor("min")
        channel = str(self.rng.choice(self.pool.channels, p=self.pool.channel_p))
        self.rows.append((ts, src, dst, round(float(amount), 2), self.currency, channel, laundering))

    def victims(self, n: int, at) -> list[str]:
        """Real background accounts that existed before `at`."""
        upto = int(np.searchsorted(self.pool.first_seen, np.datetime64(at), side="right"))
        upto = max(upto, min(n * 5, len(self.pool.accounts)))
        return self.rng.choice(self.pool.accounts[:upto], size=min(n, upto), replace=False).tolist()

    def history(self, account: str, before, n: int) -> None:
        """Ordinary activity for an account before `before`, so that it is not brand new."""
        lo, hi = self.pool.t0, pd.Timestamp(before)
        if (hi - lo) < pd.Timedelta(hours=2):
            return
        for _ in range(n):
            t = lo + (hi - lo) * float(self.rng.uniform(0, 1))
            other = self.victims(1, t)[0]
            amount = self.amount(0.2, 0.8)
            (self.pay(t, other, account, amount) if self.rng.random() < 0.5 else self.pay(t, account, other, amount))


def _hold(rng, style: str) -> pd.Timedelta:
    lo, hi = HOLD_MINUTES[style]
    return pd.Timedelta(minutes=float(np.exp(rng.uniform(np.log(lo), np.log(hi)))))  # log-uniform: more short holds


def _forward(rows: _Rows, rng, packets: list, nodes: list[str], mode: str, style: str, events: list) -> list:
    """Move packets (ts, account, amount) one level on to `nodes`; every transfer is laundering."""
    out = []

    def send(t, node, nxt, amount):
        t = pd.Timestamp(t).floor("min")
        amount = max(round(amount, 2), 0.01)
        rows.pay(t, node, nxt, amount, laundering=1)
        events.extend([(t, node), (t, nxt)])
        out.append((t, nxt, amount))

    if mode == "batched":
        window = pd.Timedelta(hours=float(rng.uniform(3, 18)))
        for node in sorted({p[1] for p in packets}):
            mine = sorted((p for p in packets if p[1] == node), key=lambda p: p[0])
            i = 0
            while i < len(mine):
                j = i
                while j + 1 < len(mine) and mine[j + 1][0] <= mine[i][0] + window:
                    j += 1
                total = sum(p[2] for p in mine[i:j + 1]) * float(rng.uniform(0.9, 0.98))
                send(mine[j][0] + _hold(rng, style), node, nodes[int(rng.integers(len(nodes)))], total)
                i = j + 1
        return out
    for t, node, amount in packets:
        carried = amount * float(rng.uniform(0.85, 0.98))
        if mode == "split" and len(nodes) > 1:
            k = int(rng.integers(2, min(len(nodes), 4) + 1))
            parts = rng.dirichlet(np.ones(k)) * carried
            for nxt, part in zip(rng.choice(len(nodes), size=k, replace=False), parts):
                send(t + _hold(rng, style) + pd.Timedelta(minutes=float(rng.uniform(0, 20))), node, nodes[int(nxt)], part)
        else:
            send(t + _hold(rng, style), node, nodes[int(rng.integers(len(nodes)))], carried)
    return out


PROFILES = {  # layers (min, max), width (min, max), victims (min, max), allowed speeds, allowed modes
    "fan-in": dict(layers=(1, 2), width=(1, 4), victims=(6, 40), speeds=["fast"], modes=["per"]),
    "dispersed": dict(layers=(1, 1), width=(4, 9), victims=(8, 45), speeds=["fast", "medium"], modes=["per"]),
    "chain": dict(layers=(3, 5), width=(1, 1), victims=(4, 12), speeds=["fast", "medium"], modes=["per"]),
    "batched": dict(layers=(1, 3), width=(1, 3), victims=(8, 40), speeds=["fast", "medium"], modes=["batched"]),
    "delayed": dict(layers=(1, 2), width=(1, 4), victims=(6, 35), speeds=["slow", "medium"], modes=["per"]),
    "split": dict(layers=(1, 3), width=(2, 4), victims=(6, 35), speeds=["fast", "medium"], modes=["split"]),
    "mixed": dict(layers=(2, 4), width=(1, 4), victims=(6, 40), speeds=["fast", "medium", "slow"],
                  modes=["per", "batched", "split"]),
    "aged": dict(layers=(1, 3), width=(1, 4), victims=(6, 40), speeds=["fast", "medium", "slow"],
                 modes=["per", "batched", "split"]),
}


def _ring(pool: _Pool, ids: _Ids, rid: int, kind: str, rng: np.random.Generator, aged_share: float) -> tuple[dict, list]:
    prof = PROFILES[kind]
    rows = _Rows(pool, rng)
    n_layers = int(rng.integers(prof["layers"][0], prof["layers"][1] + 1))
    layers = [[ids.new() for _ in range(int(rng.integers(prof["width"][0], prof["width"][1] + 1)))] for _ in range(n_layers)]
    n_coll = 1 if kind == "chain" else int(rng.choice([1, 2, 3, 4, 5], p=[0.3, 0.3, 0.2, 0.12, 0.08]))
    collectors = [ids.new() for _ in range(n_coll)]
    cashouts = [ids.new() for _ in range(int(rng.integers(1, 4)))]
    levels = layers + [cashouts]
    speeds = [str(rng.choice(prof["speeds"])) for _ in levels] if kind in ("mixed", "aged") else [str(rng.choice(prof["speeds"]))] * len(levels)
    modes = [str(rng.choice(prof["modes"])) for _ in levels]

    est_h = sum(HOLD_MINUTES[s][1] / 60 * 0.5 for s in speeds) + (18 if "batched" in modes else 0)
    window_h = float(np.exp(rng.uniform(np.log(6), np.log(96))))
    room = max(pool.span_h - window_h - min(est_h, pool.span_h * 0.5), 1.0)
    start = pool.t0 + pd.Timedelta(hours=float(rng.uniform(0, room)))
    n_vic = int(np.clip(round(np.exp(rng.uniform(np.log(prof["victims"][0]), np.log(prof["victims"][1])))), 2, 200))
    victims = rows.victims(n_vic, start)

    lo = float(rng.uniform(0.3, 0.8))
    packets = []
    for v in victims:  # deposits are ordinary-looking payments, escalating for repeat victims
        base = rows.amount(lo, min(lo + 0.15, 0.97))
        for k in range(int(rng.choice([1, 1, 2, 3]))):
            t = start + pd.Timedelta(hours=float(rng.uniform(0, window_h)))
            c = collectors[int(rng.integers(n_coll))]
            amount = round(base * (1 + 0.4 * k) * float(rng.uniform(0.9, 1.1)), 2)
            rows.pay(t, v, c, amount, laundering=0)
            packets.append((t, c, amount))

    events: list = []
    for nodes, mode, style in zip(levels, modes, speeds):
        packets = _forward(rows, rng, packets, nodes, mode, style, events)

    mules = [a for layer in layers for a in layer]
    aged = kind == "aged" or rng.random() < aged_share
    if aged:
        for a in collectors + mules + cashouts:
            rows.history(a, start, int(rng.integers(2, 9)))
    return {"pattern_id": rid, "type": kind, "collectors": collectors, "mules": mules, "cashouts": cashouts,
            "victims": victims, "events": events, "aged": aged, "speeds": speeds, "modes": modes,
            "currency": rows.currency, "_start": start}, rows.rows


def _hard(pool: _Pool, ids: _Ids, rid: int, kind: str, rng: np.random.Generator, adversarial: bool) -> tuple[dict, list]:
    rows = _Rows(pool, rng)
    hub, bank = ids.new(), ids.new()
    days = max(int(pool.span_h // 24), 1)
    day0 = lambda: pool.t0 + pd.Timedelta(days=int(rng.integers(0, days)))  # noqa: E731
    aged = bool(rng.random() < 0.5) and kind != "new-customer"
    accounts = {hub, bank}

    if kind == "merchant":
        customers = rows.victims(int(rng.integers(30, 151)), pool.t1)
        paid = []
        for c in customers:
            for _ in range(int(rng.integers(1, 4))):
                t = pool.t0 + pd.Timedelta(hours=float(rng.uniform(0, pool.span_h)))
                amount = rows.amount(0.05, 0.6)
                rows.pay(t, c, hub, amount)
                paid.append((t, amount))
        paid.sort()
        if adversarial:  # settle every hour or so, within minutes of the payments
            i = 0
            while i < len(paid):
                j = i
                while j + 1 < len(paid) and paid[j + 1][0] <= paid[i][0] + pd.Timedelta(minutes=float(rng.uniform(30, 90))):
                    j += 1
                rows.pay(paid[j][0] + pd.Timedelta(minutes=float(rng.uniform(2, 15))), hub, bank,
                         sum(p[1] for p in paid[i:j + 1]) * 0.98)
                i = j + 1
        else:
            by_day: dict[int, float] = {}
            for t, a in paid:
                by_day[(t - pool.t0).days] = by_day.get((t - pool.t0).days, 0.0) + a
            for d, total in by_day.items():
                rows.pay(pool.t0 + pd.Timedelta(days=d, hours=23), hub, bank, total * 0.98)
    elif kind == "payroll":
        for d in sorted(rng.choice(np.arange(1, max(days, 2)), size=min(2, max(days - 1, 1)), replace=False)):
            day = pool.t0 + pd.Timedelta(days=int(d), hours=8)
            staff = rows.victims(int(rng.integers(40, 151)), day)
            pays = [rows.amount(0.4, 0.9) for _ in staff]
            rows.pay(day, bank, hub, sum(pays))
            lo, hi = (1, 8) if adversarial else (5, 90)
            for e, a in zip(staff, pays):
                rows.pay(day + pd.Timedelta(minutes=float(rng.uniform(lo, hi))), hub, e, a)
    elif kind == "landlord":
        day = day0() + pd.Timedelta(hours=6)
        total = 0.0
        tenants = rows.victims(int(rng.integers(8, 21)) if adversarial else int(rng.integers(3, 13)), day)
        for tnt in tenants:
            amount = rows.amount(0.6, 0.9)
            total += amount
            t = day + pd.Timedelta(hours=float(rng.uniform(0, 16)))
            rows.pay(t, tnt, hub, amount)
            if adversarial:  # forwarded payment by payment
                rows.pay(t + pd.Timedelta(minutes=float(rng.uniform(3, 40))), hub, bank, amount * 0.99)
        if not adversarial:
            rows.pay(day + pd.Timedelta(hours=float(rng.uniform(18, 22))), hub, bank, total)
    elif kind == "charity":
        day = day0() + pd.Timedelta(hours=9)
        total = 0.0
        for d in rows.victims(int(rng.integers(100, 401)) if adversarial else int(rng.integers(30, 201)), day):
            amount = rows.amount(0.05, 0.4)
            total += amount
            rows.pay(day + pd.Timedelta(hours=float(rng.uniform(0, 4 if adversarial else 6))), d, hub, amount)
        delay = (1, 3) if adversarial else (24, 48)
        rows.pay(day + pd.Timedelta(hours=float(rng.uniform(*delay))), hub, bank, total)
    else:  # new-customer: brand new, paid, spends quickly
        accounts = {hub}
        for _ in range(int(rng.integers(1, 4))):
            t = pool.t0 + pd.Timedelta(hours=float(rng.uniform(6, max(pool.span_h - 6, 7))))
            payer = rows.victims(1, t)[0]
            amount = rows.amount(0.6, 0.95)
            rows.pay(t, payer, hub, amount)
            left = amount
            for _ in range(int(rng.integers(2, 8))):
                spend = min(rows.amount(0.1, 0.5), left) if left > 0.02 else 0.01
                left -= spend
                rows.pay(t + pd.Timedelta(minutes=float(rng.uniform(5, 360))), hub, rows.victims(1, t)[0], spend)
    if aged:
        rows.history(hub, pool.t0 + pd.Timedelta(days=min(days, 3)), int(rng.integers(3, 10)))
    return {"pattern_id": rid, "type": kind, "accounts": accounts, "hub": hub, "adversarial": adversarial,
            "aged": aged}, rows.rows


def inject(tx: pd.DataFrame, n_rings: int = 90, n_hard: int = 90, seed: int = 0, kinds: list[str] | None = None,
           hard_kinds: list[str] | None = None, adversarial: float = 0.5, aged_share: float = 0.25) -> Injected:
    """Add rings and look-alikes to `tx` (primary period, in the loader's column format).

    kinds / hard_kinds    ring shapes and look-alike types to cycle through (default: all)
    adversarial           share of look-alikes built to pass money through quickly, like a ring
    aged_share            share of non-"aged" rings whose accounts also have earlier ordinary history
    """
    kinds, hard_kinds = kinds or RING_KINDS, hard_kinds or HARD_KINDS
    pool = _Pool(tx, np.random.default_rng([seed, 0]))
    ids = _Ids()
    rings, hard, rows = [], [], []
    for i in range(n_rings):
        ring, r = _ring(pool, ids, i, kinds[i % len(kinds)], np.random.default_rng([seed, 1, i]), aged_share)
        rings.append(ring)
        rows += r
    for i in range(n_hard):
        rng = np.random.default_rng([seed, 2, i])
        h, r = _hard(pool, ids, i, hard_kinds[i % len(hard_kinds)], rng, bool(rng.random() < adversarial))
        hard.append(h)
        rows += r

    new = pd.DataFrame(rows, columns=["ts", "src", "dst", "amount", "currency", "channel", "is_laundering"])
    new = new[(new["ts"] >= pool.t0) & (new["ts"] <= pool.t1)].copy()  # keep every injected row inside the period
    new["receiving_currency"], new["amount_received"] = new["currency"], new["amount"]
    new["is_laundering"] = new["is_laundering"].astype("int8")

    # Ground truth from the rows that survived the period cut, so labels and rings always agree.
    bad = new[new["is_laundering"] == 1]
    seen = set(bad["src"]) | set(bad["dst"])
    for ring in rings:
        mine = [(t, a) for t, a in ring["events"] if t >= pool.t0 and t <= pool.t1]
        ring["events"] = sorted(mine, key=lambda e: e[0])
        members = {a for _, a in ring["events"]}
        for role in ("collectors", "mules", "cashouts"):
            ring[role] = [a for a in ring[role] if a in members]
        ring["accounts"] = members
        ring["n_tx"] = len(ring["events"]) // 2
        ring["first_ts"] = ring["events"][0][0] if ring["events"] else None
        ring["last_ts"] = ring["events"][-1][0] if ring["events"] else None
        ring.pop("_start", None)
    rings = [r for r in rings if r["accounts"]]
    assert seen == set().union(*[r["accounts"] for r in rings]) if rings else not seen

    cols = [c for c in tx.columns if c != "tx_id"]
    background = tx.drop(columns="tx_id")
    for c in cols:  # keep categorical columns categorical so memory stays low on the full data
        if isinstance(background[c].dtype, pd.CategoricalDtype):
            cats = background[c].cat.categories.union(pd.Index(new[c].astype(str).unique()))
            background[c] = background[c].astype(str).astype(pd.CategoricalDtype(cats))
            new[c] = new[c].astype(str).astype(pd.CategoricalDtype(cats))
    merged = pd.concat([background, new[cols]], ignore_index=True)
    merged = merged.sort_values("ts", kind="stable", ignore_index=True)
    merged.insert(0, "tx_id", merged.index.astype("int64"))
    existing = set(pd.unique(pd.concat([tx["src"], tx["dst"]], ignore_index=True)))
    injected_ids = set(new["src"]) | set(new["dst"])
    assert not {a for a in injected_ids if a.startswith("ACC-F")} & existing, "injected ids collide with real accounts"
    return Injected(merged, rings, hard, {"seed": seed, "n_rings": n_rings, "n_hard": n_hard, "kinds": kinds,
                                           "hard_kinds": hard_kinds, "adversarial": adversarial,
                                           "aged_share": aged_share})
