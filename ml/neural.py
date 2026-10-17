"""A neural payment scorer that runs on the IBM Z on-chip AI accelerator, used together with the XGBoost payment model.

Usage (from the repo root, inside the platform container, which has TensorFlow and the zDNN plugin):
    python -m ml.neural HI-Small <bundle folder> [inject seed]

It learns from exactly the rows the payment-level XGBoost model learns from (ml/edge_model.py: payment_frames), trains a
small dense network, picks how much weight the two models get on validation data, reports both models and their mix on
the test window, and saves the network into the bundle folder (neural.json and model_neural.keras).

Serving: the dense layers are matrix multiplications, which the ibm-zdnn-plugin sends to the NNPA facility of the
processor. `python -m ml.accel_check` shows that this really happens (hardware counters), and what it does not do:
the trees run on the ordinary CPU, and the "why flagged" explanations are the trees' (the network has no TreeSHAP).
TensorFlow is imported only when a network is trained or loaded, so every other part of the package works without it.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

KERAS_FILE = "model_neural.keras"
META_FILE = "neural.json"
CLIP = 8.0           # standardized inputs are cut to +-8 so one extreme payment cannot dominate a layer
BATCH = 8192         # inference batch: large batches keep the accelerator busy


def tensorflow_available() -> bool:
    try:
        import tensorflow  # noqa: F401
    except ImportError:
        return False
    return True


class NeuralScorer:
    """Input preparation, a Keras network and a calibration, saved and loaded as two files."""

    def __init__(self, cols: list[str], mean: np.ndarray, scale: np.ndarray, nan_cols: list[str],
                 calibration: tuple = (1.0, 0.0), weight: float = 0.5, model=None, meta: dict | None = None):
        self.cols, self.mean, self.scale, self.nan_cols = cols, mean, scale, nan_cols
        self.calibration, self.weight, self.model, self.meta = calibration, weight, model, meta or {}

    # -- inputs
    def prepare(self, rows: pd.DataFrame) -> np.ndarray:
        """Float32 matrix: a signed log, standardized and clipped; a missing value becomes the typical one plus a flag."""
        x = rows[self.cols].to_numpy(dtype="float32")
        flags = np.isnan(rows[self.nan_cols].to_numpy(dtype="float32")).astype("float32") if self.nan_cols else x[:, :0]
        x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
        x = np.sign(x) * np.log1p(np.abs(x))
        x = np.clip((x - self.mean) / self.scale, -CLIP, CLIP)
        return np.concatenate([x, flags], axis=1).astype("float32")

    # -- scoring
    def logits(self, rows: pd.DataFrame) -> np.ndarray:
        return self.model.predict(self.prepare(rows), batch_size=BATCH, verbose=0)[:, 0].astype("float64")

    def probability(self, rows: pd.DataFrame) -> np.ndarray:
        a, b = self.calibration
        return 1.0 / (1.0 + np.exp(-np.clip(a * self.logits(rows) + b, -30, 30)))

    def mix(self, p_trees: np.ndarray, p_net: np.ndarray) -> np.ndarray:
        """The served payment probability: the network's share is `weight`, the trees' the rest."""
        return self.weight * p_net + (1.0 - self.weight) * p_trees

    # -- training
    @classmethod
    def fit(cls, X_tr: pd.DataFrame, y_tr: np.ndarray, X_va: pd.DataFrame, y_va: np.ndarray, seed: int = 0,
            max_epochs: int = 30, patience: int = 4) -> "NeuralScorer":
        import tensorflow as tf
        from sklearn.linear_model import LogisticRegression  # training only
        from sklearn.metrics import average_precision_score

        cols = list(X_tr.columns)
        nan_cols = [c for c in cols if X_tr[c].isna().any()]
        raw = np.nan_to_num(X_tr.to_numpy(dtype="float32"), nan=0.0, posinf=0.0, neginf=0.0)
        logged = np.sign(raw) * np.log1p(np.abs(raw))
        scorer = cls(cols, logged.mean(axis=0), logged.std(axis=0) + 1e-6, nan_cols)
        A, B = scorer.prepare(X_tr), scorer.prepare(X_va)

        tf.keras.utils.set_random_seed(seed)
        model = tf.keras.Sequential([
            tf.keras.layers.Input((A.shape[1],)),
            tf.keras.layers.Dense(256, activation="relu"), tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dense(64, activation="relu"), tf.keras.layers.Dense(1)])  # a logit; the calibration follows
        model.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss=tf.keras.losses.BinaryCrossentropy(from_logits=True))
        pos_weight = float(np.sqrt((y_tr == 0).sum() / max(int(y_tr.sum()), 1)))  # tempered: the calibration fixes the rest
        weights = np.where(y_tr == 1, pos_weight, 1.0).astype("float32")

        best, best_weights, since, history = -1.0, None, 0, []
        for epoch in range(max_epochs):
            model.fit(A, y_tr.astype("float32"), sample_weight=weights, batch_size=2048, epochs=1, verbose=0, shuffle=True)
            ap = float(average_precision_score(y_va, model.predict(B, batch_size=BATCH, verbose=0)[:, 0]))
            history.append(round(ap, 4))
            print(f"  epoch {epoch + 1}: validation PR-AUC {ap:.4f}", flush=True)
            if ap > best:
                best, best_weights, since = ap, model.get_weights(), 0
            else:
                since += 1
                if since >= patience:
                    break
        model.set_weights(best_weights)
        scorer.model = model
        z = model.predict(B, batch_size=BATCH, verbose=0)[:, 0]
        lr = LogisticRegression(C=1e6, max_iter=1000).fit(z.reshape(-1, 1), y_va)
        scorer.calibration = (float(lr.coef_[0, 0]), float(lr.intercept_[0]))
        scorer.meta = {"layers": [256, 128, 64], "epochs_run": len(history), "best_val_pr_auc": round(best, 4),
                       "pos_weight": round(pos_weight, 2), "inputs": int(A.shape[1])}
        return scorer

    # -- files
    def save(self, folder: Path) -> None:
        folder = Path(folder)
        self.model.save(folder / KERAS_FILE)
        (folder / META_FILE).write_text(json.dumps({
            "cols": self.cols, "mean": self.mean.tolist(), "scale": self.scale.tolist(), "nan_cols": self.nan_cols,
            "calibration": list(self.calibration), "weight": self.weight, "meta": self.meta}), encoding="utf-8")

    @classmethod
    def load(cls, folder: Path) -> "NeuralScorer":
        import tensorflow as tf

        folder = Path(folder)
        d = json.loads((folder / META_FILE).read_text(encoding="utf-8"))
        return cls(d["cols"], np.array(d["mean"], dtype="float32"), np.array(d["scale"], dtype="float32"), d["nan_cols"],
                   tuple(d["calibration"]), float(d["weight"]), tf.keras.models.load_model(folder / KERAS_FILE), d["meta"])

    @staticmethod
    def exists(folder: Path) -> bool:
        return (Path(folder) / META_FILE).exists() and (Path(folder) / KERAS_FILE).exists()


def run(variant: str, folder: Path, inject_seed: int | None = None, seed: int = 0) -> None:
    import xgboost as xgb
    from sklearn.metrics import average_precision_score

    from data.ibm_aml import load_transactions, primary_period, time_split

    from .bundle import load_bundle
    from .dataset import make_snapshots
    from .edge_model import account_scores, payment_features, payment_frames
    from .model import calibrated

    bundle = load_bundle(folder)
    tx = primary_period(load_transactions(variant), variant)
    if inject_seed is None:
        snaps = make_snapshots(variant)
    else:
        from data.rings import inject

        tx = inject(tx, seed=inject_seed).tx
        snaps = make_snapshots(variant, tx=tx, tag=f"-pig{inject_seed}")
    split = time_split(tx)
    cols, ccy = bundle.cols, bundle.ccy_median
    (X_tr, y_tr), (X_va, y_va) = payment_frames(tx, split, snaps, cols, ccy, seed=seed)
    print(f"training rows {len(X_tr):,} ({int(y_tr.sum()):,} laundering), validation rows {len(X_va):,}", flush=True)
    net = NeuralScorer.fit(X_tr, y_tr, X_va, y_va, seed)

    def trees(rows):
        return calibrated(bundle.payment.predict(xgb.DMatrix(rows), output_margin=True), bundle.payment_calibration)

    p_va_t, p_va_n = trees(X_va), net.probability(X_va)
    grid = [0.0, 0.25, 0.5, 0.75, 1.0]
    val_ap = {w: average_precision_score(y_va, w * p_va_n + (1 - w) * p_va_t) for w in grid}
    net.weight = max(grid, key=val_ap.get)
    print("validation PR-AUC by network share:", {w: round(v, 4) for w, v in val_ap.items()}, "-> chosen", net.weight)

    cut = tx.loc[split == "test", "ts"].max()
    test_w = tx[split == "test"].reset_index(drop=True)
    X_te = payment_features(test_w, tx[tx["ts"] <= cut], snaps["test"].all_X, cols, ccy)
    y_te = test_w["is_laundering"].to_numpy()
    p_te_t, p_te_n = trees(X_te), net.probability(X_te)
    p_te_m = net.mix(p_te_t, p_te_n)
    truth = snaps["test"].y
    rows = []
    for name, p in (("trees (XGBoost)", p_te_t), ("neural network", p_te_n), (f"mix, network share {net.weight}", p_te_m)):
        acc = account_scores(test_w, p).reindex(snaps["test"].X.index).fillna(0.0)
        rows.append({"model": name, "payment PR-AUC": average_precision_score(y_te, p),
                     "account PR-AUC": average_precision_score(truth.to_numpy(), acc.reindex(truth.index).to_numpy())})
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 160):
        print(f"\n-- test window, {len(test_w):,} payments (chance {y_te.mean():.4f}) --")
        print(pd.DataFrame(rows).to_string(index=False))
    net.save(Path(folder))
    print(f"saved the network and its mix weight to {folder}")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "HI-Small", Path(sys.argv[2]),
        int(sys.argv[3]) if len(sys.argv) > 3 else None)
