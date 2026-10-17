"""The functions the API calls: score_account, get_ring, explain, list_rings, list_alerts.

Every function returns plain dicts shaped like api/schemas.py, so the API can pass them straight
through. A Scorer holds one scoring state: features and risk for the accounts active in a window,
the rings found among the highest-risk accounts, and the payments they are built from.
"""
import hashlib

import xgboost as xgb

import numpy as np
import pandas as pd

from .bundle import Bundle
from .model import calibrated
from .explain import shap_values, top_reasons
from .edge_model import account_scores, payment_features
from .features import build_features_with_edges
from .neighbors import stage2_inputs
from .ring_score import apply as apply_ring_scorer
from .rings import Ring, detect_rings

VICTIM_LOOKBACK_HOURS = 48
PAYMENT_WINDOW_HOURS = 24  # payments scored by a payment-level model
KEEP_TOP_SHARE = 0.05      # share of accounts whose riskiest payment is kept ready for explanations
HIGH_RISK, MEDIUM_RISK = 50, 25  # ring risk (0 to 100) cut-offs for alert severity
MAX_EDGES = 500
TYPICAL_SAMPLE = 50_000    # payments sampled to find the typical value of each feature (a reason must be really true)


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
    def __init__(self, bundle: Bundle, X: pd.DataFrame, tx: pd.DataFrame, as_of: pd.Timestamp,
                 all_X: pd.DataFrame | None = None, edges: tuple | None = None, window: pd.DataFrame | None = None):
        self.bundle, self.X, self.tx, self.as_of = bundle, X, tx, as_of
        self._payment_mode = bundle.payment is not None and all_X is not None and window is not None
        if self._payment_mode:  # score every payment in the window, then each account by its riskiest payment
            self._all_X, self._window = all_X, window.reset_index(drop=True)
            rows = payment_features(self._window, tx, all_X, bundle.cols, bundle.ccy_median)
            p = calibrated(bundle.payment.predict(xgb.DMatrix(rows), output_margin=True), bundle.payment_calibration)
            self.scores = account_scores(self._window, p).reindex(X.index).fillna(0.0)
            self._typical = rows.sample(min(len(rows), TYPICAL_SAMPLE), random_state=0).median().to_dict()
            self._keep_payment_rows(rows, p)
        else:
            self._score_accounts(X, all_X, edges)
        self.rings: list[Ring] = apply_ring_scorer(
            detect_rings(self.scores, tx, bundle.top_fraction, grow_fraction=bundle.grow_fraction), bundle.ring_scorer)
        self._by_id = {ring_id(r.members): r for r in self.rings}
        self._ring_of = {m: rid for rid, r in self._by_id.items() for m in r.members}
        self._ring_cache: dict[str, dict] = {}  # a ring is described once per Scorer, then reused
        self._ring_tx: pd.DataFrame | None = None  # payments between any two ring members, built on first use
        self._contrib: dict[str, np.ndarray] = {}  # per-account explanations filled by list_rings in one batch
        self._contrib_cols: list[str] = []
        self._values: dict[str, np.ndarray] = {}  # the feature values behind those explanations

    def _score_accounts(self, X, all_X, edges) -> None:
        bundle = self.bundle
        # a two-stage bundle also needs every account's features and the payment pairs, to summarize neighbors
        if bundle.stage2 is not None and all_X is not None:
            frame = stage2_inputs(X, bundle.cols, all_X.index, bundle.stage1_scores(all_X), edges, bundle.high_quantile)
            self._booster, self._frame, self._cols = bundle.stage2, frame, bundle.cols2
        else:
            self._booster, self._frame, self._cols = bundle.model, X, bundle.cols
        margin = self._booster.predict(xgb.DMatrix(self._frame[self._cols]), output_margin=True)
        self.scores = pd.Series(calibrated(margin, bundle.calibration), index=X.index)
        self._typical = self._frame[self._cols].median().to_dict()

    def _keep_payment_rows(self, rows: pd.DataFrame, p: np.ndarray) -> None:
        """Remember each account's riskiest payment, and keep its features for the accounts most likely to be asked about."""
        both = pd.DataFrame({"acct": np.concatenate([self._window["src"].to_numpy(), self._window["dst"].to_numpy()]),
                             "pos": np.concatenate([np.arange(len(p)), np.arange(len(p))]), "p": np.concatenate([p, p])})
        self._best = both.sort_values("p", ascending=False).drop_duplicates("acct").set_index("acct")["pos"]
        top = self.scores.nlargest(max(int(len(self.scores) * KEEP_TOP_SHARE), 1000)).index
        keep = np.unique(self._best.reindex(top).dropna().astype(int).to_numpy())
        self._payment_rows = rows.iloc[keep].set_axis(keep)

    def _payment_row(self, account_id: str) -> pd.DataFrame:
        pos = int(self._best[account_id])
        if pos not in self._payment_rows.index:  # not kept: compute this one payment's features on demand
            row = payment_features(self._window.iloc[[pos]], self.tx, self._all_X, self.bundle.cols, self.bundle.ccy_median)
            self._payment_rows = pd.concat([self._payment_rows, row.set_axis([pos])])
        return self._payment_rows.loc[[pos]]

    def _explanation_matrix(self, ids: list[str]):
        """SHAP contributions (accounts x features), the feature names they refer to, and the feature values."""
        if self._payment_mode:
            rows = pd.concat([self._payment_row(a) for a in ids])
            return shap_values(self.bundle.payment, rows), list(rows.columns), rows.to_numpy(dtype=float)
        frame = self._frame.loc[ids, self._cols]
        return shap_values(self._booster, frame), self._cols, frame.to_numpy(dtype=float)

    @classmethod
    def from_transactions(cls, bundle: Bundle, tx: pd.DataFrame, active_since: pd.Timestamp | None = None):
        """Build features from `tx` (nothing after the scoring time), then score accounts active since."""
        feats, edges = build_features_with_edges(tx, bundle.ccy_median)
        if active_since is None and bundle.payment is not None:
            active_since = tx["ts"].max() - pd.Timedelta(hours=PAYMENT_WINDOW_HOURS)
        recent = tx if active_since is None else tx[tx["ts"] > active_since]
        active = pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))
        return cls(bundle, feats.loc[active], tx, tx["ts"].max(), all_X=feats, edges=edges, window=recent)

    # -- internals
    def _inside(self, members: list[str]) -> pd.DataFrame:
        if self._ring_tx is None:  # one pass over all history; every ring's own payments are a subset of this
            every = set(self._ring_of)
            self._ring_tx = self.tx[self.tx["src"].isin(every) & self.tx["dst"].isin(every)]
        m = set(members)
        t = self._ring_tx
        return t[t["src"].isin(m) & t["dst"].isin(m) & (t["src"] != t["dst"])]

    def _reasons(self, ids: list[str], k: int = 5) -> list[dict]:
        if all(a in self._contrib for a in ids):
            return top_reasons(np.mean([self._contrib[a] for a in ids], axis=0), self._contrib_cols, k,
                               np.mean([self._values[a] for a in ids], axis=0), self._typical)
        contrib, cols, values = self._explanation_matrix(ids)
        return top_reasons(contrib.mean(axis=0), cols, k, values.mean(axis=0), self._typical)

    def _prefetch_contributions(self, ids: list[str]) -> None:
        """Explain many accounts in one model call; describing each ring separately repeats the call's fixed cost."""
        ids = [a for a in dict.fromkeys(ids) if a not in self._contrib]
        if ids:
            contrib, self._contrib_cols, values = self._explanation_matrix(ids)
            self._contrib.update(zip(ids, contrib))
            self._values.update(zip(ids, values))

    def _headline(self, r: Ring, reasons: list[dict]) -> str:
        up = [x for x in reasons if x["contribution"] > 0]  # lead with a signal that is really present, if there is one
        lead = next((x["label"] for x in up if x.get("holds") is not False), up[0]["label"] if up else "Unusual payment pattern")
        return (f"{r.size} linked accounts, {r.n_tx} payments between them, "
                f"{r.concentration:.0%} reaching one account. Top signal: {lead}.")

    # -- contract functions
    def explain(self, account_id: str, k: int = 5) -> list[dict] | None:
        if account_id not in self.X.index:
            return None
        contrib, cols, values = self._explanation_matrix([account_id])
        return top_reasons(contrib[0], cols, k, values[0], self._typical)

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
        self._prefetch_contributions([m for rid, r in self._by_id.items() if rid not in self._ring_cache
                                      for m in r.members])
        for rid in self._by_id:
            full = self.get_ring(rid)
            out.append({k: full[k] for k in keys})
        return sorted(out, key=lambda d: d["risk"], reverse=True)

    def likely_victims(self, rid: str, limit: int = 3) -> list[tuple[str, pd.Timestamp, str]]:
        """Accounts outside the ring that paid into it recently, newest first, with the ring account each one paid."""
        members = set(self._by_id[rid].members)
        recent = self.tx[(self.tx["dst"].isin(members)) & (~self.tx["src"].isin(members))
                         & (self.tx["ts"] > self.as_of - pd.Timedelta(hours=VICTIM_LOOKBACK_HOURS))]
        latest = recent.sort_values("ts", kind="stable").groupby("src")[["ts", "dst"]].last()
        latest = latest.sort_values("ts", ascending=False, kind="stable").head(limit)
        return [(src, row.ts, row.dst) for src, row in latest.iterrows()]

    def list_alerts(self, limit: int = 50, top_rings: int = 10) -> list[dict]:
        alerts = []
        for s in self.list_rings()[:top_rings]:
            sev = "high" if s["risk"] >= HIGH_RISK else "medium" if s["risk"] >= MEDIUM_RISK else "low"
            alerts.append({"alert_id": f"AL-{s['ring_id'][4:]}-R", "type": "ring", "severity": sev,
                           "ring_id": s["ring_id"], "account_id": None, "message": s["headline"],
                           "ts": s["flagged_at"]})
            for i, (acc, ts, paid) in enumerate(self.likely_victims(s["ring_id"])):
                alerts.append({"alert_id": f"AL-{s['ring_id'][4:]}-V{i}", "type": "victim_warning",
                               "severity": "medium", "ring_id": s["ring_id"], "account_id": acc, "recipient_id": paid,
                               "message": "Recent payment went to an account in a flagged ring.",
                               "ts": ts.isoformat() + "Z"})
        return sorted(alerts, key=lambda a: a["ts"], reverse=True)[:limit]
