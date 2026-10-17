"""Scoring speed of the trees and of the neural network on real payments, and whether the network matches plain arithmetic.

Usage (from the repo root, inside the platform container):
    python -m ml.accel_check trees|network [bundle folder] [slice name]

Run it through infra/accel_counters.sh to also read the processor's own NNPA counters (pai_ext), which is the evidence
that the accelerator did the work. Without the counters this script proves nothing about the accelerator: the speed
of a library says little about where its arithmetic ran. The counters are read from the host, outside the container.

The network check is separate: the accelerator computes in a reduced-precision format (DLFLOAT16), so its answers differ a
little from ordinary float32 arithmetic. We report by how much, as a probability.
"""
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from data.ibm_aml import load_transactions
from data.paths import DATA_DIR

from .bundle import load_bundle
from .edge_model import payment_features
from .features import build_features_with_edges
from .model import calibrated

REPEATS = 3


def payment_rows(bundle, slice_name: str, hours: int = 24) -> pd.DataFrame:
    tx = load_transactions(slice_name)
    tx = tx[tx["ts"] < tx["ts"].min() + pd.Timedelta(hours=hours)].reset_index(drop=True)
    feats, _ = build_features_with_edges(tx, bundle.ccy_median)
    return payment_features(tx, tx, feats, bundle.cols, bundle.ccy_median)


def numpy_forward(net, rows: pd.DataFrame) -> np.ndarray:
    """The network's answer from its weights with ordinary float32 arithmetic (no accelerator, no TensorFlow ops)."""
    x = net.prepare(rows)
    layers = [(w, b) for w, b in zip(net.model.get_weights()[0::2], net.model.get_weights()[1::2])]
    for i, (w, b) in enumerate(layers):
        x = x @ w + b
        if i < len(layers) - 1:
            x = np.maximum(x, 0)
    a, c = net.calibration
    return 1.0 / (1.0 + np.exp(-np.clip(a * x[:, 0].astype("float64") + c, -30, 30)))


def run(mode: str, folder: Path, slice_name: str) -> None:
    bundle = load_bundle(folder)
    if mode == "network" and bundle.neural is None:
        sys.exit("this bundle has no neural network (or TensorFlow is not installed here)")
    rows = payment_rows(bundle, slice_name)
    n = len(rows)
    print(f"{mode}: {n:,} payments from {slice_name}", flush=True)
    if mode == "trees":
        score = lambda: bundle.payment.predict(xgb.DMatrix(rows), output_margin=True)
    else:
        score = lambda: bundle.neural.logits(rows)
    score()  # warm up: loading kernels and building caches is not scoring
    times = []
    for _ in range(REPEATS):
        t = time.perf_counter()
        out = score()
        times.append(time.perf_counter() - t)
    best = min(times)
    print(f"RESULT {mode} seconds {best:.3f} payments_per_second {n / best:,.0f}", flush=True)
    if mode == "network":
        sample = rows.sample(min(n, 100_000), random_state=0)
        a = bundle.neural.probability(sample)
        b = numpy_forward(bundle.neural, sample)
        print(f"PARITY accelerator path against plain float32 arithmetic, {len(sample):,} payments: "
              f"largest probability difference {np.abs(a - b).max():.2e}, mean {np.abs(a - b).mean():.2e}", flush=True)


if __name__ == "__main__":
    run(sys.argv[1], Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / "HI-Small-pig",
        sys.argv[3] if len(sys.argv) > 3 else "HI-Pig-Slice")
