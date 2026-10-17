"""Transaction-level model: score each payment, then give an account the score of its riskiest payment.

The IBM data labels individual transactions. An account-level label ("touched laundering at any point")
is blurry, because laundering accounts also make ordinary payments. Here every payment gets features of the
payment itself (amount, channel, hour, currency change), of the money flow around it (how soon the sender
received money before sending, how soon the receiver passes it on) and of both endpoints (the account
features). The account score is the highest payment score in the window.

As everywhere else, features only use transactions up to the snapshot cutoff (see PROTOCOL.md).
"""
import numpy as np
import pandas as pd

from .features import CHANNELS

TX_FEATURES = (["amount_norm", "log_amount", "cross_ccy", "hour", "self_transfer",
                "prev_in_gap", "prev_in_ratio", "next_out_gap", "next_out_ratio"]
               + [f"ch_{c}" for c in CHANNELS])


def flow_features(window: pd.DataFrame, hist: pd.DataFrame, index: pd.Index, ccy_median: dict) -> pd.DataFrame:
    """Per-payment features for the rows of `window`. `hist` holds every transaction up to the cutoff.

    prev_in_gap / prev_in_ratio: minutes since the sender last received money (before this payment) and this
        payment's amount over that inbound amount. Small gap and ratio near 1 mean money passed straight through.
    next_out_gap / next_out_ratio: minutes until the receiver next sends money, and that outflow over this amount.
    """
    def codes(frame, col):
        return index.get_indexer(frame[col]).astype(np.int64)

    def norm(frame):
        return frame["amount"].to_numpy() / frame["currency"].astype(str).map(ccy_median).fillna(1.0).to_numpy()

    w = pd.DataFrame({"ts": window["ts"].to_numpy(), "src": codes(window, "src"), "dst": codes(window, "dst"),
                      "amt": norm(window), "row": np.arange(len(window))}).sort_values("ts", kind="stable")
    h_amt = norm(hist)
    inbound = pd.DataFrame({"ts": hist["ts"].to_numpy(), "acct": codes(hist, "dst"), "amt": h_amt, "ts2": hist["ts"].to_numpy()})
    outbound = pd.DataFrame({"ts": hist["ts"].to_numpy(), "acct": codes(hist, "src"), "amt": h_amt, "ts2": hist["ts"].to_numpy()})
    inbound, outbound = inbound.sort_values("ts", kind="stable"), outbound.sort_values("ts", kind="stable")

    prev = pd.merge_asof(w.rename(columns={"src": "acct"}), inbound, on="ts", by="acct", direction="backward",
                         allow_exact_matches=False, suffixes=("", "_in"))
    nxt = pd.merge_asof(w.rename(columns={"dst": "acct"}), outbound, on="ts", by="acct", direction="forward",
                        allow_exact_matches=False, suffixes=("", "_out"))
    out = pd.DataFrame(index=w["row"].to_numpy())
    out["prev_in_gap"] = ((prev["ts"] - prev["ts2"]).dt.total_seconds() / 60).to_numpy()
    out["prev_in_ratio"] = (prev["amt"] / prev["amt_in"]).to_numpy()
    out["next_out_gap"] = ((nxt["ts2"] - nxt["ts"]).dt.total_seconds() / 60).to_numpy()
    out["next_out_ratio"] = (nxt["amt_out"] / nxt["amt"]).to_numpy()
    return out.sort_index().reset_index(drop=True)


def payment_features(window: pd.DataFrame, hist: pd.DataFrame, all_X: pd.DataFrame, cols: list[str],
                     ccy_median: dict) -> pd.DataFrame:
    """One row per payment in `window`: payment features, flow features, and both endpoints' account features."""
    amt = window["amount"].to_numpy() / window["currency"].astype(str).map(ccy_median).fillna(1.0).to_numpy()
    base = pd.DataFrame({
        "amount_norm": amt, "log_amount": np.log1p(amt),
        "cross_ccy": (window["currency"].astype(str).to_numpy() != window["receiving_currency"].astype(str).to_numpy()).astype(float),
        "hour": window["ts"].dt.hour.to_numpy().astype(float),
        "self_transfer": (window["src"].to_numpy() == window["dst"].to_numpy()).astype(float),
    })
    channel = window["channel"].astype(str).to_numpy()
    for c in CHANNELS:
        base[f"ch_{c}"] = (channel == c).astype(float)
    flow = flow_features(window, hist, all_X.index, ccy_median)
    src_x = all_X[cols].iloc[all_X.index.get_indexer(window["src"])].add_prefix("s_").reset_index(drop=True)
    dst_x = all_X[cols].iloc[all_X.index.get_indexer(window["dst"])].add_prefix("d_").reset_index(drop=True)
    rows = pd.concat([base.reset_index(drop=True), flow, src_x, dst_x], axis=1).astype("float32")
    return rows


def account_scores(window: pd.DataFrame, payment_scores: np.ndarray) -> pd.Series:
    """Each account's score is the highest score among the window's payments it sent or received."""
    both = pd.concat([pd.Series(payment_scores, index=window["src"].to_numpy()),
                      pd.Series(payment_scores, index=window["dst"].to_numpy())])
    return both.groupby(level=0).max().rename("risk")
