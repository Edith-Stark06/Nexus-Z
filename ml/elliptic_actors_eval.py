"""A real-data check of the ring idea: Elliptic++ wallet (actor) graph of Bitcoin, illicit against licit.

Usage (from the repo root):  python -m ml.elliptic_actors_eval [folder with the Elliptic++ actor files]
Runs five training seeds (the split and the graphs are fixed) and reports means and standard deviations.

The data is Elliptic++ (Elmougy and Liu, KDD 2023): 822,942 Bitcoin wallet addresses with 55 features per address and time step,
a label per address (illicit, licit, or unknown) and a directed address-to-address payment graph. It is NOT pig-butchering: "illicit" is
Elliptic's generic label. The dataset has no stated licence and asks for citation; we use it for evaluation only and never copy it
into the repository.

The address-to-address edge list has no timestamps, so the design must not let a later edge reach an earlier address:
  * each address is one row, its last row up to its window; its features describe its whole life, which lies inside its window
  * train: addresses whose last time step is at most 28; validation: last step 29 to 34; test: addresses that first appear at step 35 or
    later (new addresses; their whole life, and every edge between two of them, is in the test period)
  * graph features and rings use only edges between addresses of the same window (train graph for train, train plus validation for
    validation, test graph for test)
Only labeled addresses are scored; unlabeled (class 3) addresses stay in the graph and in ring formation, as they would in use.

Questions, in order: (1) do illicit wallets cluster in the payment graph (homophily)? (2) do our graph features add anything over the
dataset's own features? (3) do rings of flagged wallets hold more illicit wallets than the same wallets alone, i.e. does grouping help?
"""
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.csgraph import connected_components
from sklearn.metrics import average_precision_score, roc_auc_score
from xgboost import XGBClassifier

from data.paths import DATA_DIR

from .features import _core_numbers, _pagerank, _structure
from .rings import detect_rings

TRAIN_END, VAL_END, TEST_START = 28, 34, 35
TOP_FRACTIONS = [0.005, 0.01, 0.02]
GRAPH_COLS = ["g_in_deg", "g_out_deg", "g_pagerank", "g_kcore", "g_clustering", "g_comp_size", "g_comp_avg_deg"]


def load(folder: Path):
    """One row per address (its last row), with first and last time step and the label (1 illicit, 0 licit, -1 unknown)."""
    header = pd.read_csv(folder / "wallets_features.csv", nrows=0).columns
    dtypes = {c: np.float32 for c in header if c != "address"}
    feats = pd.read_csv(folder / "wallets_features.csv", dtype=dtypes).rename(columns={"Time step": "ts"})
    span = feats.groupby("address")["ts"].agg(first_ts="min", last_ts="max")
    last = feats.loc[feats.groupby("address")["ts"].idxmax()].set_index("address")
    del feats
    classes = pd.read_csv(folder / "wallets_classes.csv").set_index("address")["class"]
    table = last.join(span).join(classes.rename("cls"))
    table["y"] = table["cls"].map({1: 1, 2: 0, 3: -1}).fillna(-1).astype(int)
    edges = pd.read_csv(folder / "AddrAddr_edgelist.csv", dtype=str)
    src = table.index.get_indexer(edges["input_address"])
    dst = table.index.get_indexer(edges["output_address"])
    ok = (src >= 0) & (dst >= 0) & (src != dst)
    return table.reset_index(), src[ok], dst[ok]


def graph_features(n: int, src: np.ndarray, dst: np.ndarray) -> pd.DataFrame:
    """Structure of the graph on nodes 0..n-1 with the given directed edges (the same helpers the main model uses)."""
    pair = np.unique(src.astype(np.int64) * n + dst)
    s, d = pair // n, pair % n
    A = sparse.csr_matrix((np.ones(len(s)), (s, d)), shape=(n, n))
    S = ((A + A.T) > 0).astype(float).tocsr()
    S.setdiag(0)
    S.eliminate_zeros()
    clustering, comp_size, comp_avg_deg = _structure(S, cap=100)
    return pd.DataFrame({"g_in_deg": np.asarray(A.sum(0)).ravel(), "g_out_deg": np.asarray(A.sum(1)).ravel(),
                         "g_pagerank": _pagerank(s, d, np.ones(len(s)), n), "g_kcore": _core_numbers(S).astype(float),
                         "g_clustering": clustering, "g_comp_size": comp_size, "g_comp_avg_deg": comp_avg_deg})


def window_graph(table: pd.DataFrame, src: np.ndarray, dst: np.ndarray, member: np.ndarray):
    """Graph features for the addresses selected by `member` (a boolean array), from edges between them only."""
    ids = np.flatnonzero(member)
    local = np.full(len(table), -1, dtype=np.int64)
    local[ids] = np.arange(len(ids))
    keep = member[src] & member[dst]
    return ids, graph_features(len(ids), local[src[keep]], local[dst[keep]]), src[keep], dst[keep]


def homophily(src: np.ndarray, dst: np.ndarray, y: np.ndarray) -> dict:
    """Among edges whose two ends are both labeled: how often an illicit address pays or is paid by another illicit one, against chance."""
    both = (y[src] >= 0) & (y[dst] >= 0)
    a, b = y[src][both], y[dst][both]
    base = float((y[y >= 0] == 1).mean())
    ill_a = a == 1
    ill_to_ill = float(b[ill_a].mean()) if ill_a.any() else float("nan")
    return {"labeled_edges": int(both.sum()), "illicit_share_of_labeled": base, "p_neighbor_illicit_given_illicit": ill_to_ill,
            "lift": ill_to_ill / base if base else float("nan"), "illicit_illicit_edges": int((ill_a & (b == 1)).sum())}


def fit(X_tr, y_tr, X_va, y_va, seed: int = 0) -> XGBClassifier:
    pos = max(int((y_tr == 1).sum()), 1)
    model = XGBClassifier(n_estimators=600, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
                          scale_pos_weight=float((y_tr == 0).sum() / pos), eval_metric="aucpr", early_stopping_rounds=40,
                          tree_method="hist", n_jobs=-1, random_state=seed)
    model.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    return model


def precision_at(y: np.ndarray, score: np.ndarray, k: int) -> float:
    return float(y[np.argsort(-score)[:k]].mean())


def ring_report(rings, y_of: dict, flagged: set) -> dict:
    """How pure the rings are, and whether wallets inside rings are more often illicit than the same score level outside them."""
    purity, real, labeled_total, illicit_in = [], 0, 0, set()
    members = set()
    for r in rings:
        members.update(r.members)
        lab = [y_of[m] for m in r.members if y_of[m] >= 0]
        if len(lab) < 2:
            continue
        labeled_total += 1
        share = float(np.mean([v == 1 for v in lab]))
        purity.append(share)
        real += share >= 0.5
        illicit_in.update(m for m in r.members if y_of[m] == 1)
    in_ring = [m for m in flagged if m in members and y_of[m] >= 0]
    alone = [m for m in flagged if m not in members and y_of[m] >= 0]
    prec = lambda ms: float(np.mean([y_of[m] == 1 for m in ms])) if ms else float("nan")
    return {"rings": len(rings), "rings_with_2_labeled": labeled_total, "mean_purity": float(np.mean(purity)) if purity else float("nan"),
            "share_real": real / labeled_total if labeled_total else float("nan"), "illicit_in_rings": len(illicit_in),
            "flagged_labeled_in_rings": len(in_ring), "precision_in_rings": prec(in_ring),
            "flagged_labeled_alone": len(alone), "precision_alone": prec(alone)}


def run(folder: Path, seeds: tuple = (0, 1, 2, 3, 4)) -> None:
    started = time.time()
    table, src, dst = load(folder)
    first, last, y = table["first_ts"].to_numpy(), table["last_ts"].to_numpy(), table["y"].to_numpy()
    base_cols = [c for c in table.columns if c not in ("address", "ts", "first_ts", "last_ts", "cls", "y")]
    print(f"{len(table):,} addresses, {len(src):,} address-to-address edges, {len(base_cols)} features; "
          f"labeled illicit {int((y == 1).sum()):,}, licit {int((y == 0).sum()):,}, unknown {int((y == -1).sum()):,}  [{time.time() - started:.0f}s]", flush=True)

    train_m, val_m, test_m = last <= TRAIN_END, (last > TRAIN_END) & (last <= VAL_END), first >= TEST_START
    print(f"windows: train {int(train_m.sum()):,}, validation {int(val_m.sum()):,}, test (new addresses) {int(test_m.sum()):,}", flush=True)
    ids_tr, g_tr, _, _ = window_graph(table, src, dst, train_m)
    ids_va, g_va_all, _, _ = window_graph(table, src, dst, train_m | val_m)   # validation graph also holds the train addresses
    ids_te, g_te, s_te, d_te = window_graph(table, src, dst, test_m)
    pos_va = np.searchsorted(ids_va, np.flatnonzero(val_m))
    g_va = g_va_all.iloc[pos_va]
    print(f"graph features built [{time.time() - started:.0f}s]", flush=True)

    homo = homophily(s_te, d_te, y)
    print(f"\n-- (1) do illicit wallets cluster? test graph, edges with both ends labeled --\n"
          f"  {homo['labeled_edges']:,} labeled edges; illicit share of labeled wallets {homo['illicit_share_of_labeled']:.3f}; "
          f"given an illicit wallet, the chance its neighbor is illicit {homo['p_neighbor_illicit_given_illicit']:.3f} "
          f"(lift {homo['lift']:.1f}x; {homo['illicit_illicit_edges']:,} illicit-illicit edges)", flush=True)

    def frame(ids, g=None):
        X = table.iloc[ids][base_cols].reset_index(drop=True)
        return X if g is None else pd.concat([X, g.reset_index(drop=True)], axis=1)

    lab = lambda ids: y[ids] >= 0
    sets = {"dataset features": (frame(ids_tr), frame(np.flatnonzero(val_m)), frame(ids_te)),
            "+ our graph features": (frame(ids_tr, g_tr), frame(np.flatnonzero(val_m), g_va), frame(ids_te, g_te))}
    y_te = y[ids_te]
    chance = float((y_te[y_te >= 0] == 1).mean())
    tx = pd.DataFrame({"src": s_te, "dst": d_te})   # global ids; only edges between test addresses
    y_of = dict(zip(ids_te.tolist(), y_te.tolist()))
    wallet_rows, ring_rows = [], []
    for seed in seeds:
        scores = {}
        for name, (Xtr, Xva, Xte) in sets.items():
            m_tr, m_va = lab(ids_tr), lab(np.flatnonzero(val_m))
            model = fit(Xtr[m_tr], y[ids_tr][m_tr], Xva[m_va], y[np.flatnonzero(val_m)][m_va], seed)
            s = model.predict_proba(Xte)[:, 1]
            scores[name] = s
            m = y_te >= 0
            wallet_rows.append({"features": name, "seed": seed, "trees": model.best_iteration + 1,
                                "PR-AUC": average_precision_score(y_te[m], s[m]), "ROC-AUC": roc_auc_score(y_te[m], s[m]),
                                "precision@100": precision_at(y_te[m], s[m], 100), "precision@1000": precision_at(y_te[m], s[m], 1000)})
        for name, s in list(scores.items()) + [("random score (baseline)", np.random.default_rng(seed).random(len(ids_te)))]:
            series = pd.Series(s, index=ids_te)
            for frac in TOP_FRACTIONS:
                if name.startswith("random") and frac != TOP_FRACTIONS[1]:
                    continue
                flagged = set(series.index[series >= series.quantile(1 - frac)].tolist())
                fl = [m for m in flagged if y_of[m] >= 0]
                rings = detect_rings(series, tx, frac, min_size=3, max_size=40)
                ring_rows.append({"features": name, "flagged top": frac, "seed": seed, "flagged labeled": len(fl),
                                  "wallet precision": float(np.mean([y_of[m] == 1 for m in fl])), **ring_report(rings, y_of, flagged)})
        print(f"seed {seed} done [{time.time() - started:.0f}s]", flush=True)

    def summarize(rows, keys):
        df = pd.DataFrame(rows).drop(columns=["seed"])
        g = df.groupby(keys, sort=False)
        mean, sd = g.mean(numeric_only=True), g.std(numeric_only=True)
        return mean, sd

    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 250, "display.max_columns", 30):
        mean, sd = summarize(wallet_rows, ["features"])
        print(f"\n-- (2) wallet level, test (new addresses), {int((y_te >= 0).sum()):,} labeled, chance PR-AUC {chance:.3f}; mean and (std) over {len(seeds)} seeds --")
        print(mean.join(sd, rsuffix=" sd").to_string())
        mean, sd = summarize(ring_rows, ["features", "flagged top"])
        keep = ["flagged labeled", "wallet precision", "rings", "rings_with_2_labeled", "mean_purity", "share_real", "illicit_in_rings",
                "flagged_labeled_in_rings", "precision_in_rings", "flagged_labeled_alone", "precision_alone"]
        print(f"\n-- (3) rings of flagged wallets (strict share of test wallets flagged, linked by payments between them); mean over {len(seeds)} seeds --")
        print(mean[keep].to_string())
        print("\nstd over seeds of the ring-level columns that carry the claim:")
        print(sd[["wallet precision", "mean_purity", "precision_in_rings", "precision_alone"]].to_string())
    print(f"\ndone in {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    run(Path(sys.argv[1]) if len(sys.argv) > 1 else DATA_DIR / "elliptic++")
