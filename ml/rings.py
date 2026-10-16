"""Group high-risk accounts into rings.

Take the accounts with the highest risk scores, keep the payments between them, and split the
result into connected groups. A group that is too large to be one ring is split again with Louvain
community detection. Each ring gets a risk score and descriptors an analyst can read.
"""
from dataclasses import dataclass

import networkx as nx
import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.csgraph import connected_components


@dataclass
class Ring:
    members: list[str]
    risk: float            # mean of the three highest member scores, 0 to 1
    size: int
    density: float         # distinct linked pairs over possible pairs
    concentration: float   # largest share of the ring's internal payments received by one account
    n_tx: int              # payments between members


def _describe(members: list[str], scores: pd.Series, edges: pd.DataFrame) -> Ring:
    inside = edges[edges["src"].isin(members) & edges["dst"].isin(members)]
    n = len(members)
    pairs = inside[["src", "dst"]].apply(frozenset, axis=1).nunique() if len(inside) else 0
    top3 = scores.reindex(members).nlargest(3)
    received = inside.groupby("dst")["n"].sum()
    total = inside["n"].sum()
    return Ring(
        members=members, risk=float(top3.mean()), size=n,
        density=float(pairs / (n * (n - 1) / 2)) if n > 1 else 0.0,
        concentration=float(received.max() / total) if total else 0.0,
        n_tx=int(total),
    )


def detect_rings(scores: pd.Series, tx: pd.DataFrame, top_fraction: float, min_size: int = 3,
                 max_size: int = 40, seed: int = 0) -> list[Ring]:
    """Rings among the top `top_fraction` of accounts by score, using payments in `tx`.

    `tx` must only contain transactions up to the scoring time.
    """
    cutoff = scores.quantile(1 - top_fraction)
    top = scores.index[scores >= cutoff]
    pair = tx[tx["src"].isin(top) & tx["dst"].isin(top) & (tx["src"] != tx["dst"])]
    edges = pair.groupby(["src", "dst"], observed=True).size().rename("n").reset_index()
    if edges.empty:
        return []

    nodes = pd.Index(pd.unique(pd.concat([edges["src"], edges["dst"]], ignore_index=True)))
    r, c = nodes.get_indexer(edges["src"]), nodes.get_indexer(edges["dst"])
    adj = sparse.csr_matrix((np.ones(len(r)), (r, c)), shape=(len(nodes), len(nodes)))
    _, label = connected_components(adj, directed=False)

    rings = []
    for lab in np.unique(label):
        members = nodes[label == lab].tolist()
        if len(members) < min_size:
            continue
        if len(members) > max_size:
            sub = nx.Graph()
            sub.add_edges_from(edges.loc[edges["src"].isin(members) & edges["dst"].isin(members),
                                         ["src", "dst"]].itertuples(index=False))
            for community in nx.community.louvain_communities(sub, seed=seed):
                if len(community) >= min_size:
                    rings.append(_describe(sorted(community), scores, edges))
        else:
            rings.append(_describe(sorted(members), scores, edges))
    return sorted(rings, key=lambda x: x.risk, reverse=True)
