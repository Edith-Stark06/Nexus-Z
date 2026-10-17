"""Group high-risk accounts into rings.

Take the accounts with the highest risk scores, keep the payments between them, and split the
result into connected groups. A group that is too large to be one ring is split again with Louvain
community detection. Each ring gets descriptors an analyst can read, and a risk score.
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
    risk: float            # ring risk, 0 to 1. Mean of the three highest member scores until a ring scorer is applied
    size: int
    density: float         # distinct linked pairs over possible pairs
    concentration: float   # largest share of the ring's internal payments received by one account
    n_tx: int              # payments between members
    mean_score: float = 0.0
    min_score: float = 0.0
    max_score: float = 0.0
    top3_score: float = 0.0


def _split(graph: nx.Graph, max_size: int, seed: int, resolution: float = 1.0, depth: int = 0) -> list[set]:
    """Louvain communities, re-split at a higher resolution while any is larger than max_size."""
    parts = []
    for community in nx.community.louvain_communities(graph, resolution=resolution, seed=seed):
        if len(community) > max_size and depth < 5:
            parts += _split(graph.subgraph(community).copy(), max_size, seed, resolution * 2, depth + 1)
        else:
            parts.append(community)
    return parts


def detect_rings(scores: pd.Series, tx: pd.DataFrame, top_fraction: float, min_size: int = 3,
                 max_size: int = 40, seed: int = 0, grow_fraction: float | None = None) -> list[Ring]:
    """Rings among the top `top_fraction` of accounts by score, using payments in `tx`.

    With `grow_fraction` (larger than `top_fraction`) a ring must still contain at least one account from the
    strict top share, but it may also take in linked accounts from the wider top `grow_fraction`. Strict seeds
    keep the rings real; the wider net lets a ring gather its weaker members.

    `tx` must only contain transactions up to the scoring time.
    """
    strict = scores.quantile(1 - top_fraction)
    cutoff = scores.quantile(1 - max(grow_fraction or top_fraction, top_fraction))
    top = scores.index[scores >= cutoff]
    pair = tx[tx["src"].isin(top) & tx["dst"].isin(top) & (tx["src"] != tx["dst"])]
    edges = pair.groupby(["src", "dst"], observed=True).size().rename("n").reset_index()
    if edges.empty:
        return []

    nodes = pd.Index(pd.unique(pd.concat([edges["src"], edges["dst"]], ignore_index=True)))
    seed_node = (scores.reindex(nodes).to_numpy() >= strict)  # strict accounts; every node when not growing
    r, c = nodes.get_indexer(edges["src"]), nodes.get_indexer(edges["dst"])
    n_pay = edges["n"].to_numpy()
    adj = sparse.csr_matrix((np.ones(len(r)), (r, c)), shape=(len(nodes), len(nodes)))
    _, comp = connected_components(adj, directed=False)

    ring_of = np.full(len(nodes), -1)
    n_rings = 0
    for lab in np.unique(comp):
        members = np.flatnonzero(comp == lab)
        if len(members) < min_size or not seed_node[members].any():
            continue
        if len(members) <= max_size:
            ring_of[members] = n_rings
            n_rings += 1
            continue
        keep = (comp[r] == lab) & (comp[c] == lab)
        sub = nx.Graph()
        sub.add_edges_from(zip(r[keep].tolist(), c[keep].tolist()))
        for community in _split(sub, max_size, seed):
            if len(community) >= min_size and seed_node[list(community)].any():
                ring_of[list(community)] = n_rings
                n_rings += 1
    if n_rings == 0:
        return []

    # descriptors for every ring at once
    rs, rd = ring_of[r], ring_of[c]
    inside = (rs >= 0) & (rs == rd)
    e = pd.DataFrame({"ring": rs[inside], "a": np.minimum(r, c)[inside], "b": np.maximum(r, c)[inside],
                      "dst": c[inside], "n": n_pay[inside]})
    n_tx = e.groupby("ring")["n"].sum().reindex(range(n_rings), fill_value=0)
    linked_pairs = e.drop_duplicates(["ring", "a", "b"]).groupby("ring").size().reindex(range(n_rings), fill_value=0)
    top_received = e.groupby(["ring", "dst"])["n"].sum().groupby(level=0).max().reindex(range(n_rings), fill_value=0)

    member_df = pd.DataFrame({"ring": ring_of, "node": np.arange(len(nodes)), "score": scores.reindex(nodes).to_numpy()})
    member_df = member_df[member_df["ring"] >= 0].sort_values(["ring", "score"], ascending=[True, False])
    by_ring = member_df.groupby("ring")["score"]
    top3 = member_df[member_df.groupby("ring").cumcount() < 3].groupby("ring")["score"].mean()
    size = by_ring.size()
    stats = pd.DataFrame({"size": size, "mean": by_ring.mean(), "min": by_ring.min(), "max": by_ring.max(), "top3": top3})
    names = member_df.groupby("ring")["node"].apply(lambda x: sorted(nodes[x.to_numpy()].tolist()))

    rings = []
    for i in range(n_rings):
        n = int(stats.at[i, "size"])
        total = int(n_tx[i])
        rings.append(Ring(
            members=names[i], risk=float(stats.at[i, "top3"]), size=n,
            density=float(linked_pairs[i] / (n * (n - 1) / 2)) if n > 1 else 0.0,
            concentration=float(top_received[i] / total) if total else 0.0, n_tx=total,
            mean_score=float(stats.at[i, "mean"]), min_score=float(stats.at[i, "min"]),
            max_score=float(stats.at[i, "max"]), top3_score=float(stats.at[i, "top3"])))
    return sorted(rings, key=lambda x: x.risk, reverse=True)
