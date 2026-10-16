"""Deterministic sample rings for the stub backend. Every ID and number here is invented."""
import math
import random
from datetime import datetime, timedelta, timezone

from .schemas import AccountScore, Alert, Edge, Member, Neighborhood, Reason, Ring

BASE = datetime(2026, 10, 14, 0, 0, tzinfo=timezone.utc)

# (ring number, collectors, mules, victims, hours of deposits, risk, headline, reason weights)
RING_SPECS = [
    (417, 3, 4, 21, 36, 94, "21 people paid three accounts within 36 hours. Most of it left within 15 minutes.",
     (0.34, 0.28, 0.17, 0.12, -0.05)),
    (392, 2, 3, 12, 48, 81, "Five new accounts share one device and feed one cash-out.",
     (0.26, 0.22, 0.20, 0.09, -0.04)),
    (455, 1, 2, 9, 30, 73, "Night-time bursts, then a transfer to a crypto exchange.",
     (0.21, 0.24, 0.10, 0.18, -0.06)),
]

REASON_LABELS = [
    ("fan_in_ratio", "Many payers, few receivers"),
    ("pass_through_minutes", "Money leaves within minutes"),
    ("account_age_days", "Accounts opened recently"),
    ("burst_timing", "Deposits arrive in bursts"),
    ("account_history", "One mule has a long history"),
]


def _account_ids(rng: random.Random, count: int, used: set[str]) -> list[str]:
    ids = []
    while len(ids) < count:
        acc = "ACC-%04X" % rng.randrange(0x10000)
        if acc not in used:
            used.add(acc)
            ids.append(acc)
    return ids


def _reasons(weights) -> list[Reason]:
    return [Reason(feature=f, label=label, contribution=w) for (f, label), w in zip(REASON_LABELS, weights)]


def build_ring(number, n_coll, n_mule, n_victims, hours, risk, headline, weights, used) -> Ring:
    rng = random.Random(number)
    start = BASE + timedelta(hours=rng.randint(2, 10) + number % 7)
    ids = _account_ids(rng, n_coll + n_mule + 1 + n_victims, used)
    if number == 417:  # the account used in the warning screen mock-up
        used.discard(ids[0])
        ids[0] = "ACC-7F3A"
        used.add("ACC-7F3A")
    collectors, rest = ids[:n_coll], ids[n_coll:]
    mules, cashout, victims = rest[:n_mule], rest[n_mule], rest[n_mule + 1:]
    half = math.ceil(n_mule / 2)
    layer1, layer2 = mules[:half], mules[half:]

    edges: list[Edge] = []
    for v in victims:
        for _ in range(rng.choice([1, 1, 2])):
            when = start + timedelta(minutes=rng.randrange(hours * 60))
            edges.append(Edge(src=v, dst=rng.choice(collectors), amount=float(rng.randrange(10, 100) * 50), ts=when))

    inbound = {c: [e for e in edges if e.dst == c] for c in collectors}
    for c, deposits in inbound.items():
        deposits.sort(key=lambda e: e.ts)
        for i in range(2, len(deposits), 3):  # forward the batch a few minutes after every third deposit
            batch = sum(e.amount for e in deposits[i - 2:i + 1])
            t = deposits[i].ts + timedelta(minutes=rng.randint(2, 14))
            hop1 = rng.choice(layer1)
            edges.append(Edge(src=c, dst=hop1, amount=round(batch * 0.9, 2), ts=t))
            t2 = t + timedelta(minutes=rng.randint(2, 14))
            if layer2:
                hop2 = rng.choice(layer2)
                edges.append(Edge(src=hop1, dst=hop2, amount=round(batch * 0.85, 2), ts=t2))
                edges.append(Edge(src=hop2, dst=cashout, amount=round(batch * 0.8, 2), ts=t2 + timedelta(minutes=rng.randint(2, 14))))
            else:
                edges.append(Edge(src=hop1, dst=cashout, amount=round(batch * 0.85, 2), ts=t2))
    edges.sort(key=lambda e: e.ts)

    members = (
        [Member(id=a, role="collector", score=round(rng.uniform(0.93, 0.99), 2)) for a in collectors]
        + [Member(id=a, role="mule", score=round(rng.uniform(0.85, 0.95), 2)) for a in mules]
        + [Member(id=cashout, role="cashout", score=round(rng.uniform(0.90, 0.97), 2))]
        + [Member(id=a, role="victim", score=round(rng.uniform(0.02, 0.15), 2)) for a in victims]
    )
    victim_set = set(victims)
    total = sum(e.amount for e in edges if e.src in victim_set)
    return Ring(
        ring_id="RNG-%04d" % number,
        risk=risk,
        accounts=len(members),
        victims=n_victims,
        headline=headline,
        first_seen=edges[0].ts,
        flagged_at=edges[0].ts + timedelta(hours=hours * 0.6),
        total_amount=round(total, 2),
        members=members,
        edges=edges,
        top_reasons=_reasons(weights),
    )


def build_rings() -> list[Ring]:
    used: set[str] = set()
    rings = [build_ring(*spec, used=used) for spec in RING_SPECS]
    return sorted(rings, key=lambda r: r.risk, reverse=True)


def build_alerts(rings: list[Ring]) -> list[Alert]:
    alerts: list[Alert] = []
    for r in rings:
        sev = "high" if r.risk >= 80 else "medium"
        alerts.append(Alert(alert_id=f"AL-{r.ring_id[4:]}-R", type="ring", severity=sev, ring_id=r.ring_id,
                            account_id=None, message=r.headline, ts=r.flagged_at))
        victims = [m for m in r.members if m.role == "victim"][:2]
        for i, v in enumerate(victims):
            alerts.append(Alert(alert_id=f"AL-{r.ring_id[4:]}-V{i}", type="victim_warning", severity="medium",
                                ring_id=r.ring_id, account_id=v.id,
                                message="Recent payment went to an account in a flagged ring.",
                                ts=r.flagged_at + timedelta(minutes=5 * (i + 1))))
    return sorted(alerts, key=lambda a: a.ts, reverse=True)


def build_account(ring: Ring, member: Member) -> AccountScore:
    n_in = sum(e.dst == member.id for e in ring.edges)
    n_out = sum(e.src == member.id for e in ring.edges)
    return AccountScore(
        account_id=member.id, risk=member.score, role=member.role, ring_id=ring.ring_id,
        reasons=ring.top_reasons[:3],
        neighborhood=Neighborhood(in_degree=n_in, out_degree=n_out, ring_size=ring.accounts),
    )
