"""The functions the API calls: score_account, get_ring, explain, list_rings, list_alerts.

Every function returns plain dicts shaped like api/schemas.py, so the API can pass them straight
through. A Scorer holds one scoring state: features and risk for the accounts active in a window,
the rings found among the highest-risk accounts, and the payments they are built from.
"""
import hashlib

import numpy as np
import pandas as pd

from .bundle import Bundle
from .model import calibrated
from .explain import shap_values, top_reasons
from .features import build_features
from .ring_score import apply as apply_ring_scorer
from .rings import Ring, detect_rings

VICTIM_LOOKBACK_HOURS = 48
HIGH_RISK, MEDIUM_RISK = 50, 25  # ring risk (0 to 100) cut-offs for alert severity
MAX_EDGES = 500


def ring_id(members: list[str]) -> str:
    return "RNG-" + hashlib.blake2b(",".join(sorted(members)).encode(), digest_size=3).hexdigest().upper()


def infer_roles(members: list[str], inside: pd.DataFrame) -> dict[str, str]:
    """Guess each member's role from its position in the ring's internal payments.

    No inflow from inside the ring: victim. No outflow: cash-out. Of the rest, accounts receiving
    from several others (at least half the busiest account's inflow): collector. Otherwise mule.
    """
    inflow = inside.groupby("dst").size().reindex(members, fill_value=0)
    outflow = inside.groupby("src").size().reindex(members, fill_value=0)
    middle = [m for m in members if inflow[m] > 0 and outflow[m] > 0]
    busiest = max((inflow[m] for m in middle), default=0)
    roles = {}
    for m in members:
        if inflow[m] == 0:
            roles[m] = "victim"
        elif outflow[m] == 0:
            roles[m] = "cashout"
        elif inflow[m] >= 2 and inflow[m] >= busiest / 2:
            roles[m] = "collector"
        else:
            roles[m] = "mule"
    return roles


class Scorer:
    def __init__(self, bundle: Bundle, X: pd.DataFrame, tx: pd.DataFrame, as_of: pd.Timestamp):
        self.bundle, self.X, self.tx, self.as_of = bundle, X, tx, as_of
        self.scores = pd.Series(calibrated(bundle.margin(X), bundle.calibration), index=X.index)
        self.rings: list[Ring] = apply_ring_scorer(detect_rings(self.scores, tx, bundle.top_fraction), bundle.ring_scorer)
        self._by_id = {ring_id(r.members): r for r in self.rings}
        self._ring_of = {m: rid for rid, r in self._by_id.items() for m in r.members}
        self._ring_cache: dict[str, dict] = {}  # a ring is described once per Scorer, then reused

    @classmethod
    def from_transactions(cls, bundle: Bundle, tx: pd.DataFrame, active_since: pd.Timestamp | None = None):
        """Build features from `tx` (nothing after the scoring time), then score accounts active since."""
        feats = build_features(tx, bundle.ccy_median)
        recent = tx if active_since is None else tx[tx["ts"] > active_since]
        active = pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))
        return cls(bundle, feats.loc[active], tx, tx["ts"].max())

    # -- internals
    def _inside(self, members: list[str]) -> pd.DataFrame:
        m = set(members)
        return self.tx[self.tx["src"].isin(m) & self.tx["dst"].isin(m) & (self.tx["src"] != self.tx["dst"])]

    def _reasons(self, ids: list[str], k: int = 5) -> list[dict]:
        contrib = shap_values(self.bundle.model, self.X.loc[ids, self.bundle.cols])
        return top_reasons(contrib.mean(axis=0), self.bundle.cols, k)

    def _headline(self, r: Ring, reasons: list[dict]) -> str:
        lead = next((x["label"] for x in reasons if x["contribution"] > 0), "Unusual payment pattern")
        return (f"{r.size} linked accounts, {r.n_tx} payments between them, "
                f"{r.concentration:.0%} reaching one account. Top signal: {lead}.")

    # -- contract functions
    def explain(self, account_id: str, k: int = 5) -> list[dict] | None:
        if account_id not in self.X.index:
            return None
        contrib = shap_values(self.bundle.model, self.X.loc[[account_id], self.bundle.cols])[0]
        return top_reasons(contrib, self.bundle.cols, k)

    def score_account(self, account_id: str) -> dict | None:
        if account_id not in self.X.index:
            return None
        row, rid = self.X.loc[account_id], self._ring_of.get(account_id)
        role = None
        if rid:
            roles = infer_roles(self._by_id[rid].members, self._inside(self._by_id[rid].members))
            role = roles[account_id]
        return {
            "account_id": account_id, "risk": round(float(self.scores[account_id]), 4), "role": role,
            "ring_id": rid, "reasons": self.explain(account_id, 3),
            "neighborhood": {"in_degree": int(row["n_in_cp"]), "out_degree": int(row["n_out_cp"]),
                             "ring_size": self._by_id[rid].size if rid else None},
        }

    def get_ring(self, rid: str) -> dict | None:
        if rid not in self._by_id:
            return None
        if rid not in self._ring_cache:
            self._ring_cache[rid] = self._describe_ring(rid)
        return self._ring_cache[rid]

    def _describe_ring(self, rid: str) -> dict:
        r = self._by_id[rid]
        inside = self._inside(r.members)
        roles = infer_roles(r.members, inside)
        reasons = self._reasons(r.members)
        edges = inside.sort_values("ts").tail(MAX_EDGES)
        return {
            "ring_id": rid, "risk": int(round(r.risk * 100)), "accounts": r.size,
            "victims": sum(v == "victim" for v in roles.values()),
            "headline": self._headline(r, reasons),
            "first_seen": inside["ts"].min().isoformat() + "Z", "flagged_at": self.as_of.isoformat() + "Z",
            "total_amount": round(float(inside["amount"].sum()), 2),
            "members": [{"id": m, "role": roles[m], "score": round(float(self.scores[m]), 4)} for m in r.members],
            "edges": [{"src": e.src, "dst": e.dst, "amount": float(e.amount), "ts": e.ts.isoformat() + "Z"}
                      for e in edges.itertuples()],
            "top_reasons": reasons,
        }

    def list_rings(self) -> list[dict]:
        keys = ("ring_id", "risk", "accounts", "victims", "headline", "first_seen", "flagged_at")
        out = []
        for rid in self._by_id:
            full = self.get_ring(rid)
            out.append({k: full[k] for k in keys})
        return sorted(out, key=lambda d: d["risk"], reverse=True)

    def likely_victims(self, rid: str, limit: int = 3) -> list[tuple[str, pd.Timestamp]]:
        """Accounts outside the ring that paid into it recently, newest first."""
        members = set(self._by_id[rid].members)
        recent = self.tx[(self.tx["dst"].isin(members)) & (~self.tx["src"].isin(members))
                         & (self.tx["ts"] > self.as_of - pd.Timedelta(hours=VICTIM_LOOKBACK_HOURS))]
        latest = recent.groupby("src")["ts"].max().sort_values(ascending=False).head(limit)
        return list(latest.items())

    def list_alerts(self, limit: int = 50, top_rings: int = 10) -> list[dict]:
        alerts = []
        for s in self.list_rings()[:top_rings]:
            sev = "high" if s["risk"] >= HIGH_RISK else "medium" if s["risk"] >= MEDIUM_RISK else "low"
            alerts.append({"alert_id": f"AL-{s['ring_id'][4:]}-R", "type": "ring", "severity": sev,
                           "ring_id": s["ring_id"], "account_id": None, "message": s["headline"],
                           "ts": s["flagged_at"]})
            for i, (acc, ts) in enumerate(self.likely_victims(s["ring_id"])):
                alerts.append({"alert_id": f"AL-{s['ring_id'][4:]}-V{i}", "type": "victim_warning",
                               "severity": "medium", "ring_id": s["ring_id"], "account_id": acc,
                               "message": "Recent payment went to an account in a flagged ring.",
                               "ts": ts.isoformat() + "Z"})
        return sorted(alerts, key=lambda a: a["ts"], reverse=True)[:limit]
