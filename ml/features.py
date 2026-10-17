"""Account features from the transactions visible at a cutoff time. See PROTOCOL.md.

build_features expects only transactions with ts <= the scoring time; it never looks ahead.
"""
import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.csgraph import connected_components

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

STRUCTURE_COLS = ["kcore", "clustering", "comp_size", "comp_avg_deg"]
# Burst and motif signals: how many different accounts pay or are paid within one short block of time
# (a pig-butchering collector shows a fan-in burst), directed 3-cycles, feed-forward loops (a pays b and c,
# b pays c), and repeated outgoing amounts (splitting).
MOTIF_COLS = ["fanin_1h", "fanin_6h", "fanin_24h", "fanout_1h", "fanout_6h", "fanout_24h", "cyc3", "ffl",
              "dup_amount_share"]

FEATURE_VERSION = 3  # bump when columns change so cached snapshots are rebuilt
HUB_DEGREE_CAP = 100  # accounts with more distinct neighbors are left out of triangle and component counts
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


def _core_numbers(S: sparse.csr_matrix) -> np.ndarray:
    """k-core number of every node of a symmetric 0/1 adjacency matrix, by peeling low degrees."""
    deg = np.asarray(S.sum(axis=1)).ravel().copy()
    alive = np.ones(S.shape[0], bool)
    core = np.zeros(S.shape[0], np.int64)
    k = 0
    while alive.any():
        k = max(k, int(deg[alive].min()))
        while True:
            peel = np.flatnonzero(alive & (deg <= k))
            if peel.size == 0:
                break
            core[peel] = k
            alive[peel] = False
            deg -= np.asarray(S[peel].sum(axis=0)).ravel()
        k += 1
    return core


def _structure(S: sparse.csr_matrix, cap: int = HUB_DEGREE_CAP, chunk: int = 50_000):
    """Clustering coefficient and component size/density on the graph without hub accounts.

    Hubs (more than `cap` neighbors) are excluded from triangle and component counting, since
    exact triangles around a hub with tens of thousands of neighbors are impractical. Their own
    clustering and component values are NaN.
    """
    N = S.shape[0]
    deg = np.asarray(S.sum(axis=1)).ravel()
    hub = deg > cap
    keep = sparse.diags((~hub).astype(np.float64))
    Sc = (keep @ S @ keep).tocsr()

    tri = np.zeros(N)
    for lo in range(0, N, chunk):
        rows = Sc[lo:lo + chunk]
        tri[lo:lo + chunk] = np.asarray(rows.multiply(rows @ Sc).sum(axis=1)).ravel() / 2
    pairs = deg * (deg - 1) / 2
    clustering = np.where(pairs > 0, tri / np.maximum(pairs, 1), 0.0)

    _, label = connected_components(Sc, directed=False)
    size = np.bincount(label)
    edge_ends = np.bincount(label, weights=np.asarray(Sc.sum(axis=1)).ravel())
    comp_size = size[label].astype(float)
    comp_avg_deg = (edge_ends / size)[label]
    return (np.where(hub, np.nan, clustering), np.where(hub, np.nan, comp_size),
            np.where(hub, np.nan, comp_avg_deg))


def _block_fan(acc, other, tm, hours, n_acc):
    """Largest number of different counterparties an account has inside any one block of `hours` hours."""
    block = (tm // (hours * 60)).astype(np.int64)
    n_block = int(block.max()) + 1
    triple = np.unique((acc.astype(np.int64) * n_block + block) * n_acc + other)
    cell, per_cell = np.unique(triple // n_acc, return_counts=True)
    return _agg(per_cell, cell // n_block, n_acc, "max")


def _motifs(A, deg_total, cap: int = HUB_DEGREE_CAP, chunk: int = 50_000):
    """Directed 3-cycles and feed-forward loops per node, on the graph without hub accounts."""
    N = A.shape[0]
    keep = sparse.diags((deg_total <= cap).astype(np.float64))
    Ac = (keep @ A @ keep).tocsr()
    AT = Ac.T.tocsr()
    cyc, ffl = np.zeros(N), np.zeros(N)
    for lo in range(0, N, chunk):
        rows = Ac[lo:lo + chunk]
        paths = rows @ Ac  # two-step paths from each node in the chunk
        cyc[lo:lo + chunk] = np.asarray(paths.multiply(AT[lo:lo + chunk]).sum(axis=1)).ravel()
        ffl[lo:lo + chunk] = np.asarray(paths.multiply(rows).sum(axis=1)).ravel()
    return cyc, ffl


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

    keep = us != ud
    S = sparse.csr_matrix((np.ones(int(keep.sum())), (us[keep], ud[keep])), shape=(N, N))
    S = ((S + S.T) > 0).astype(np.float64).tocsr()
    f["kcore"] = _core_numbers(S).astype(float)
    f["clustering"], f["comp_size"], f["comp_avg_deg"] = _structure(S)

    # burst and motif features
    for hours in (1, 6, 24):
        f[f"fanin_{hours}h"] = _block_fan(d, s, tm, hours, N)
        f[f"fanout_{hours}h"] = _block_fan(s, d, tm, hours, N)
    no_self = A.copy()
    no_self.setdiag(0)
    no_self.eliminate_zeros()
    f["cyc3"], f["ffl"] = _motifs(no_self.tocsr(), np.asarray(S.sum(axis=1)).ravel())
    cents = np.rint(tx["amount"].to_numpy() * 100).astype(np.int64)
    amount_key, key_count = np.unique(s.astype(np.int64) * 1_000_000_000_000 + cents, return_counts=True)
    repeated = amount_key[key_count > 1]
    dup = np.isin(s.astype(np.int64) * 1_000_000_000_000 + cents, repeated)
    f["dup_amount_share"] = np.bincount(s[dup], minlength=N) / np.maximum(out_cnt, 1)

    cols = TX_COLS + BEHAVIOR_COLS + GRAPH_COLS + STRUCTURE_COLS + MOTIF_COLS
    return pd.DataFrame({c: f[c] for c in cols}, index=pd.Index(accs, name="account"))
