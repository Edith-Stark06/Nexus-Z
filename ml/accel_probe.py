"""Three small workloads for measuring what the IBM Z on-chip AI accelerator (NNPA) really does.

Usage (inside the platform container, which has TensorFlow with the zDNN plugin and llama.cpp built with zDNN):
    python -m ml.accel_probe dense|granite|trees

  dense    a TensorFlow network (120 inputs, 256, 128, 1) scoring 200,000 rows of random numbers; the dense layers are matrix
           multiplications, which the ibm-zdnn-plugin sends to NNPA
  granite  IBM Granite 4.0 350M (the platform's base model) writing 40 tokens through llama.cpp built with zDNN
  trees    an XGBoost model scoring the same 200,000 rows, as the control: trees do not use the accelerator

Run it through infra/accel_counters.sh, which reads the processor's own NNPA counters (pai_ext) from outside the container while
each workload runs. Speed alone proves nothing about where arithmetic ran, and the labs on the platform only print a checklist of
"accelerated ops", so the counters are the evidence.

This is a measurement of the platform, not a claim about NEXUS Z: our detection model is trees on the CPU. A network trained on the
same data (ml/neural.py) was worse than the trees and a mix gave no gain; Granite wrote sentences that were wrong (see ml/narrative.py).
"""
import os
import sys
import time

import numpy as np

ROWS = 200_000
GRANITE = os.environ.get("NEXUSZ_GRANITE_MODEL", "/home/ibm-user/granite-4.0-h-350m-base-be.f16.gguf")


def features() -> np.ndarray:
    return np.random.default_rng(0).normal(size=(ROWS, 120)).astype("float32")


def dense() -> None:
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    import tensorflow as tf

    X = features()
    net = tf.keras.Sequential([tf.keras.layers.Input((120,)), tf.keras.layers.Dense(256, activation="relu"),
                               tf.keras.layers.Dense(128, activation="relu"), tf.keras.layers.Dense(1, activation="sigmoid")])
    net.predict(X[:1000], verbose=0)   # warm-up: loading kernels is not scoring
    t = time.perf_counter()
    for _ in range(5):
        net.predict(X, batch_size=8192, verbose=0)
    dt = (time.perf_counter() - t) / 5
    print(f"RESULT dense rows_per_second {ROWS / dt:,.0f}")


def trees() -> None:
    import xgboost as xgb

    X = features()
    y = (X[:20000, 0] + X[:20000, 1] > 0).astype(float)
    booster = xgb.train({"max_depth": 6, "tree_method": "hist"}, xgb.DMatrix(X[:20000], label=y), 200)
    booster.predict(xgb.DMatrix(X))
    t = time.perf_counter()
    for _ in range(5):
        booster.predict(xgb.DMatrix(X))   # a new matrix each time: XGBoost caches predictions per matrix
    dt = (time.perf_counter() - t) / 5
    print(f"RESULT trees rows_per_second {ROWS / dt:,.0f}")


def granite() -> None:
    from llama_cpp import Llama

    llm = Llama(model_path=GRANITE, n_ctx=1024, n_batch=512, n_threads=3, verbose=False)
    prompt = "Signal: money leaves within minutes\nMeaning: Funds that arrive and are sent on almost at once are typical of accounts used to pass money along.\nSignal: the same amounts repeat\nMeaning:"
    llm.create_completion(prompt, max_tokens=4, temperature=0)   # warm-up
    t = time.perf_counter()
    out = llm.create_completion(prompt, max_tokens=40, temperature=0)
    dt = time.perf_counter() - t
    print(f"RESULT granite tokens_per_second {out['usage']['completion_tokens'] / dt:.1f}")


if __name__ == "__main__":
    {"dense": dense, "granite": granite, "trees": trees}[sys.argv[1]]()
