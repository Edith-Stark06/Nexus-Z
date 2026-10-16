"""Account features from the transactions visible at a cutoff time. See PROTOCOL.md.

build_features expects only transactions with ts <= the scoring time; it never looks ahead.
"""
import numpy as np
import pandas as pd
from scipy import sparse

CHANNELS = ["ACH", "Bitcoin", "Cash", "Cheque", "Credit Card", "Reinvestment", "Wire"]

TX_COLS = (
    ["out_cnt", "in_cnt", "out_sum", "in_sum", "out_max", "in_max", "out_mean", "in_mean",
     "out_cv", "out_in_ratio", "self_share", "cross_ccy_share"]
    + [f"out_share_{c}" for c in CHANNELS]
    + [f"in_share_{c}" for c in CHANNELS]
)
BEHAVIOR_COLS = ["span_h", "velocity", "max_tx_per_hour", "hours_active", "pt_min", "pt_median",
                 "fast_out_share", "no_prior_in_share"]
GRAPH_COLS = ["n_out_cp", "n_in_cp", "fan_in_ratio", "repeat_out", "pagerank", "out_nb_in_cp_mean",
              "in_nb_out_cp_mean", "two_hop_out", "two_hop_in", "reciprocity"]

FAST_MINUTES = 15  # an outflow within this many minutes of an inflow counts as fast pass-through
_HOUR_KEY = 100_000
_TIME_KEY = 1e7


def _agg(values, keys, n, how):
    """Group values by integer keys and return a length-n array (0 where a key never appears)."""
    r = getattr(pd.Series(values).groupby(keys), how)()
    out = np.zeros(n)
    out[r.index.to_numpy()] = r.to_numpy()
    return out


def _pagerank(src, dst, weight, n, damping=0.85, iters=30):
    out_w = np.bincount(src, weights=weight, minlength=n)
    p = sparse.csr_matrix((weight / out_w[src], (dst, src)), shape=(n, n))
    dangling = out_w == 0
    r = np.full(n, 1.0 / n)
    for _ in range(iters):
        r = (1 - damping) / n + damping * (p @ r + r[dangling].sum() / n)
    return r * n


def build_features(tx: pd.DataFrame, ccy_median: dict) -> pd.DataFrame:
    """One row per account seen in tx, indexed by account id."""
    n = len(tx)
    codes, accs = pd.factorize(pd.concat([tx["src"], tx["dst"]], ignore_index=True))
    N = len(accs)
    s, d = codes[:n], codes[n:]
    tm = ((tx["ts"] - tx["ts"].min()).dt.total_seconds() / 60).to_numpy()
    scale = tx["currency"].astype(str).map(ccy_median).fillna(1.0).to_numpy()
    amt = tx["amount"].to_numpy() / scale
    chan = tx["channel"].astype(str).to_numpy()

    f = {}
    # transaction aggregates
    out_cnt = np.bincount(s, minlength=N).astype(float)
    in_cnt = np.bincount(d, minlength=N).astype(float)
    f["out_cnt"], f["in_cnt"] = out_cnt, in_cnt
    f["out_sum"] = np.bincount(s, weights=amt, minlength=N)
    f["in_sum"] = np.bincount(d, weights=amt, minlength=N)
    f["out_max"], f["in_max"] = _agg(amt, s, N, "max"), _agg(amt, d, N, "max")
    f["out_mean"] = f["out_sum"] / np.maximum(out_cnt, 1)
    f["in_mean"] = f["in_sum"] / np.maximum(in_cnt, 1)
    f["out_cv"] = _agg(amt, s, N, "std") / np.maximum(f["out_mean"], 1e-9)
    f["out_in_ratio"] = f["out_sum"] / (f["in_sum"] + 1.0)
    f["self_share"] = np.bincount(s[s == d], minlength=N) / np.maximum(out_cnt, 1)
    cross = tx["currency"].astype(str).to_numpy() != tx["receiving_currency"].astype(str).to_numpy()
    f["cross_ccy_share"] = np.bincount(s[cross], minlength=N) / np.maximum(out_cnt, 1)
    for c in CHANNELS:
        m = chan == c
        f[f"out_share_{c}"] = np.bincount(s[m], minlength=N) / np.maximum(out_cnt, 1)
        f[f"in_share_{c}"] = np.bincount(d[m], minlength=N) / np.maximum(in_cnt, 1)

    # behavior: one event per side of each transaction
    ev_acc = np.concatenate([s, d]).astype(np.int64)
    ev_t = np.concatenate([tm, tm])
    ev_out = np.concatenate([np.ones(n, bool), np.zeros(n, bool)])
    first, last = _agg(ev_t, ev_acc, N, "min"), _agg(ev_t, ev_acc, N, "max")
    f["span_h"] = (last - first) / 60
    f["velocity"] = (out_cnt + in_cnt) / (f["span_h"] + 1)
    hour_key, per_hour = np.unique(ev_acc * _HOUR_KEY + (ev_t // 60).astype(np.int64), return_counts=True)
    hour_acc = hour_key // _HOUR_KEY
    f["max_tx_per_hour"] = _agg(per_hour, hour_acc, N, "max")
    f["hours_active"] = np.bincount(hour_acc, minlength=N).astype(float)

    # pass-through: delay from the latest earlier inflow to each outflow, per account
    order = np.lexsort((ev_out, ev_t, ev_acc))  # by account, then time, inflows before outflows
    a, t, o = ev_acc[order], ev_t[order], ev_out[order]
    base = a * _TIME_KEY
    last_in = np.maximum.accumulate(np.where(~o, base + t, -1.0))
    has_in = o & (last_in >= base)
    delay = (t - (last_in - base))[has_in]
    out_acc = a[has_in]
    f["pt_min"] = np.where(np.isin(np.arange(N), out_acc), _agg(delay, out_acc, N, "min"), np.nan)
    f["pt_median"] = np.where(np.isin(np.arange(N), out_acc), _agg(delay, out_acc, N, "median"), np.nan)
    f["fast_out_share"] = np.bincount(out_acc[delay <= FAST_MINUTES], minlength=N) / np.maximum(out_cnt, 1)
    f["no_prior_in_share"] = 1 - np.bincount(out_acc, minlength=N) / np.maximum(out_cnt, 1)
    f["no_prior_in_share"] = np.where(out_cnt > 0, f["no_prior_in_share"], 0.0)

    # graph structure on the unique account-to-account edges
    pair, pair_cnt = np.unique(s.astype(np.int64) * N + d, return_counts=True)
    us, ud = pair // N, pair % N
    n_out_cp = np.bincount(us, minlength=N).astype(float)
    n_in_cp = np.bincount(ud, minlength=N).astype(float)
    f["n_out_cp"], f["n_in_cp"] = n_out_cp, n_in_cp
    f["fan_in_ratio"] = n_in_cp / (n_out_cp + 1)
    f["repeat_out"] = out_cnt / np.maximum(n_out_cp, 1)
    f["pagerank"] = _pagerank(us, ud, np.log1p(pair_cnt), N)
    A = sparse.csr_matrix((np.ones(len(pair)), (us, ud)), shape=(N, N))
    AT = A.T.tocsr()
    ones = np.ones(N)
    f["out_nb_in_cp_mean"] = (A @ n_in_cp) / np.maximum(n_out_cp, 1)
    f["in_nb_out_cp_mean"] = (AT @ n_out_cp) / np.maximum(n_in_cp, 1)
    f["two_hop_out"] = np.log1p(A @ (A @ ones))
    f["two_hop_in"] = np.log1p(AT @ (AT @ ones))
    f["reciprocity"] = np.asarray(A.multiply(AT).sum(axis=1)).ravel() / np.maximum(n_out_cp, 1)

    cols = TX_COLS + BEHAVIOR_COLS + GRAPH_COLS
    return pd.DataFrame({c: f[c] for c in cols}, index=pd.Index(accs, name="account"))
