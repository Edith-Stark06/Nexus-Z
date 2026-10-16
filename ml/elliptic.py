"""Does graph structure help on a real labeled graph? The Elliptic Bitcoin transaction data.

Usage (from the repo root):  python -m ml.elliptic

Nodes are Bitcoin transactions (not accounts). 49 time steps; no edge crosses a time step, so
splitting by time step cannot leak. Labels: 1 illicit, 2 licit, unlabeled otherwise.
Split: steps 1-29 train, 30-34 val, 35-49 test. The test steps include the dark-market shutdown
at step 43, after which models trained on earlier steps are known to degrade, so this is a hard
test. Only labeled nodes are scored.

Feature sets compared:
  local         the 93 features of the transaction itself
  + our graph   local plus structure we compute from the edge list: degrees, PageRank, k-core,
                clustering, and the mean of the neighbors' local features (in and out)
  provided      the dataset's own 72 one-hop aggregates added to local (their graph features)
"""
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.metrics import average_precision_score, precision_recall_curve
from xgboost import XGBClassifier

from data.paths import ELLIPTIC_DIR

from .features import _core_numbers, _pagerank, _structure

TRAIN_MAX, VAL_MAX = 29, 34
NEIGHBOR_FEATURES = 20  # neighbor means are taken over the first 20 local features, to keep the table small


def load():
    feats = pd.read_csv(ELLIPTIC_DIR / "elliptic_txs_features.csv", header=None)
    classes = pd.read_csv(ELLIPTIC_DIR / "elliptic_txs_classes.csv")
    edges = pd.read_csv(ELLIPTIC_DIR / "elliptic_txs_edgelist.csv")
    feats.columns = ["txId", "step"] + [f"f{i}" for i in range(2, 167)]
    y = feats[["txId"]].merge(classes, on="txId", how="left")["class"].map({"1": 1, "2": 0}).to_numpy(dtype=float)
    return feats, y, edges


def graph_features(feats: pd.DataFrame, edges: pd.DataFrame) -> pd.DataFrame:
    n = len(feats)
    index = pd.Series(np.arange(n), index=feats["txId"].to_numpy())
    src, dst = index.reindex(edges["txId1"]).to_numpy(), index.reindex(edges["txId2"]).to_numpy()
    ok = ~(np.isnan(src) | np.isnan(dst))
    src, dst = src[ok].astype(int), dst[ok].astype(int)
    A = sparse.csr_matrix((np.ones(len(src)), (src, dst)), shape=(n, n))
    out_deg, in_deg = np.asarray(A.sum(1)).ravel(), np.asarray(A.sum(0)).ravel()

    S = ((A + A.T) > 0).astype(float).tocsr()
    S.setdiag(0)
    S.eliminate_zeros()
    clustering, comp_size, comp_avg_deg = _structure(S, cap=100)

    cols = {"g_in_deg": in_deg, "g_out_deg": out_deg, "g_pagerank": _pagerank(src, dst, np.ones(len(src)), n),
            "g_kcore": _core_numbers(S).astype(float), "g_clustering": clustering,
            "g_comp_size": comp_size, "g_comp_avg_deg": comp_avg_deg}
    local = feats[[f"f{i}" for i in range(3, 3 + NEIGHBOR_FEATURES)]].to_numpy()
    for name, M, deg in (("out", A, out_deg), ("in", A.T.tocsr(), in_deg)):
        mean = (M @ local) / np.maximum(deg, 1)[:, None]
        mean[deg == 0] = np.nan
        for j in range(NEIGHBOR_FEATURES):
            cols[f"nb_{name}_f{j + 3}"] = mean[:, j]
    return pd.DataFrame(cols)


def best_f1_threshold(y, p):
    prec, rec, thr = precision_recall_curve(y, p)
    f1 = 2 * prec[:-1] * rec[:-1] / np.maximum(prec[:-1] + rec[:-1], 1e-12)
    return float(thr[f1.argmax()])


def run(seeds=(0, 1, 2)) -> pd.DataFrame:
    feats, y, edges = load()
    graph = graph_features(feats, edges)
    local_cols = [f"f{i}" for i in range(2, 95)]            # 93 local features (f2 is the first after the step)
    provided_cols = [f"f{i}" for i in range(95, 167)]      # 72 one-hop aggregates shipped with the data
    X = pd.concat([feats[local_cols + provided_cols], graph], axis=1)
    sets = {"local": local_cols, "+ our graph features": local_cols + list(graph.columns),
            "+ provided one-hop aggregates": local_cols + provided_cols}

    labeled = ~np.isnan(y)
    step = feats["step"].to_numpy()
    tr, va, te = (labeled & (step <= TRAIN_MAX), labeled & (step > TRAIN_MAX) & (step <= VAL_MAX),
                  labeled & (step > VAL_MAX))
    print(f"labeled nodes: train {tr.sum():,} ({int(y[tr].sum())} illicit), val {va.sum():,} "
          f"({int(y[va].sum())}), test {te.sum():,} ({int(y[te].sum())})")

    rows = []
    for name, cols in sets.items():
        aps, f1s, precs, recs = [], [], [], []
        for seed in seeds:
            m = XGBClassifier(n_estimators=600, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
                              scale_pos_weight=float((y[tr] == 0).sum() / y[tr].sum()), eval_metric="aucpr",
                              early_stopping_rounds=40, tree_method="hist", n_jobs=-1, random_state=seed)
            m.fit(X.loc[tr, cols], y[tr], eval_set=[(X.loc[va, cols], y[va])], verbose=False)
            thr = best_f1_threshold(y[va], m.predict_proba(X.loc[va, cols])[:, 1])
            p = m.predict_proba(X.loc[te, cols])[:, 1]
            pred = p >= thr
            tp = (pred & (y[te] == 1)).sum()
            prec, rec = tp / max(pred.sum(), 1), tp / y[te].sum()
            aps.append(average_precision_score(y[te], p))
            precs.append(prec), recs.append(rec), f1s.append(2 * prec * rec / max(prec + rec, 1e-12))
        rows.append({"features": name, "n_features": len(cols), "pr_auc": np.mean(aps), "pr_auc_std": np.std(aps),
                     "precision": np.mean(precs), "recall": np.mean(recs), "f1": np.mean(f1s)})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print(run().to_string(index=False))
