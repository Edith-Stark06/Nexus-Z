import numpy as np
import pandas as pd
import pytest

from ml.neural import NeuralScorer


def scorer(**kw):
    return NeuralScorer(["a", "b"], np.zeros(2, dtype="float32"), np.ones(2, dtype="float32"), ["b"], **kw)


def test_inputs_are_a_signed_log_clipped_with_a_flag_for_missing_values():
    rows = pd.DataFrame({"a": [0.0, np.e - 1, -(np.e - 1), 1e12], "b": [1.0, np.nan, 2.0, 3.0]})
    x = scorer().prepare(rows)
    assert x.shape == (4, 3) and x.dtype == np.float32           # a, b and the missing-value flag of b
    assert x[0, 0] == 0 and x[1, 0] == pytest.approx(1.0, abs=1e-5) and x[2, 0] == pytest.approx(-1.0, abs=1e-5)
    assert x[3, 0] == 8.0                                           # clipped
    assert x[:, 2].tolist() == [0.0, 1.0, 0.0, 0.0] and x[1, 1] == 0.0   # flagged, and filled with the typical value


def test_mix_is_a_weighted_average_of_probabilities():
    s = scorer(weight=0.25)
    out = s.mix(np.array([0.2, 0.8]), np.array([0.6, 0.0]))
    assert out == pytest.approx([0.25 * 0.6 + 0.75 * 0.2, 0.75 * 0.8])
    assert scorer(weight=0.0).mix(np.array([0.3]), np.array([0.9]))[0] == pytest.approx(0.3)
    assert scorer(weight=1.0).mix(np.array([0.3]), np.array([0.9]))[0] == pytest.approx(0.9)


def test_network_trains_saves_and_loads_when_tensorflow_is_installed(tmp_path):
    pytest.importorskip("tensorflow")
    pytest.importorskip("sklearn")
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(3000, 4)), columns=list("abcd"))
    y = (X["a"] + 0.5 * X["b"] > 1.5).astype(int).to_numpy()
    net = NeuralScorer.fit(X[:2000], y[:2000], X[2000:], y[2000:], max_epochs=3)
    p = net.probability(X[2000:])
    assert p.shape == (1000,) and 0 <= p.min() and p.max() <= 1 and p[y[2000:] == 1].mean() > p[y[2000:] == 0].mean()
    net.weight = 0.4
    net.save(tmp_path)
    again = NeuralScorer.load(tmp_path)
    assert again.weight == 0.4 and np.allclose(again.probability(X[2000:]), p, atol=1e-5)
