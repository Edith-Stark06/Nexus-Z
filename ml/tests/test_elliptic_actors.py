import numpy as np
import pandas as pd

from ml.elliptic_actors_eval import graph_features, homophily, precision_at, ring_report, window_graph
from ml.rings import Ring


def test_graph_features_count_unique_neighbours_and_components():
    # a path 0 -> 1 -> 2 (the edge 1 -> 2 appears twice), a separate pair 3 -> 4 and an isolated node 5; self loops are removed by load()
    src = np.array([0, 1, 1, 3])
    dst = np.array([1, 2, 2, 4])
    g = graph_features(6, src, dst)
    assert g["g_out_deg"].tolist() == [1, 1, 0, 1, 0, 0] and g["g_in_deg"].tolist() == [0, 1, 1, 0, 1, 0]   # repeated edges count once
    assert g["g_comp_size"].tolist()[:5] == [3, 3, 3, 2, 2]


def test_a_window_graph_keeps_only_edges_between_its_own_addresses():
    table = pd.DataFrame({"address": list("abcd")})
    src, dst = np.array([0, 1, 2]), np.array([1, 2, 3])             # a-b, b-c, c-d
    member = np.array([True, True, False, True])                    # c is outside the window
    ids, g, s, d = window_graph(table, src, dst, member)
    assert ids.tolist() == [0, 1, 3] and (s.tolist(), d.tolist()) == ([0], [1])   # only a-b survives
    assert len(g) == 3


def test_homophily_compares_with_the_chance_of_an_illicit_neighbour():
    y = np.array([1, 1, 1, 0, 0, 0, 0, 0, -1])                      # 3 illicit of 8 labeled
    src, dst = np.array([0, 1, 3, 4, 2, 8]), np.array([1, 2, 5, 6, 3, 0])
    h = homophily(src, dst, y)
    assert h["labeled_edges"] == 5 and h["illicit_illicit_edges"] == 2           # 0-1 and 1-2; the edge to the unknown is not counted
    assert abs(h["illicit_share_of_labeled"] - 3 / 8) < 1e-9 and abs(h["p_neighbor_illicit_given_illicit"] - 2 / 3) < 1e-9


def ring(members):
    return Ring(members=members, risk=0.9, size=len(members), density=1.0, concentration=0.5, n_tx=3)


def test_ring_report_separates_wallets_in_rings_from_flagged_wallets_alone():
    y_of = {0: 1, 1: 1, 2: 0, 3: 1, 4: 0, 5: -1, 6: 0}
    rep = ring_report([ring([0, 1, 2]), ring([4, 5, 6])], y_of, flagged={0, 1, 3, 4})
    assert rep["rings"] == 2 and rep["rings_with_2_labeled"] == 2
    assert abs(rep["mean_purity"] - (2 / 3 + 0.0) / 2) < 1e-9 and rep["share_real"] == 0.5 and rep["illicit_in_rings"] == 2
    assert rep["flagged_labeled_in_rings"] == 3 and abs(rep["precision_in_rings"] - 2 / 3) < 1e-9
    assert rep["flagged_labeled_alone"] == 1 and rep["precision_alone"] == 1.0   # wallet 3 is illicit and in no ring


def test_precision_at_k_takes_the_highest_scores():
    assert precision_at(np.array([0, 1, 1, 0]), np.array([0.1, 0.9, 0.8, 0.3]), 2) == 1.0
