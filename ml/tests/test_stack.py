import numpy as np
import pytest

from ml.stack import NEIGHBOR_COLS, _row_max, neighbor_features


def tiny_graph():
    #  p1 -> c, p2 -> c, c -> m          account order: p1, p2, c, m
    edges = (np.array([0, 1, 2]), np.array([2, 2, 3]))
    scores = np.array([0.9, 0.1, 0.5, 0.3])
    return scores, edges


def test_neighbor_summaries_on_a_small_chain():
    scores, edges = tiny_graph()
    f = neighbor_features(scores, edges, high_quantile=0.5)   # high = score above the median 0.4: p1 and c
    assert list(f.columns) == NEIGHBOR_COLS
    c, p1, m = 2, 0, 3
    assert f["nb_in_mean"][c] == pytest.approx(0.5)           # payers p1 (0.9) and p2 (0.1)
    assert f["nb_in_max"][c] == pytest.approx(0.9)
    assert f["nb_out_mean"][c] == pytest.approx(0.3) and f["nb_out_max"][p1] == pytest.approx(0.5)
    assert f["nb_in_high"][c] == 1 and f["nb_in_high_share"][c] == pytest.approx(0.5)
    assert f["nb_in_mean2"][m] == pytest.approx(0.5)          # m is paid by c, whose payers average 0.5
    assert f["nb_in_mean"][p1] == 0 and f["nb_out_max"][m] == 0   # no payers, no payees


def test_row_max_handles_empty_rows():
    from scipy import sparse

    M = sparse.csr_matrix(np.array([[0, 1, 1], [0, 0, 0], [1, 0, 0]], float))
    assert _row_max(M, np.array([5.0, 2.0, 7.0])).tolist() == [7.0, 0.0, 5.0]
