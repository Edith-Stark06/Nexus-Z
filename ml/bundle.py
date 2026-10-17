"""The trained model plus everything needed to score with it, saved as a folder.

Usage (from the repo root):  python -m ml.bundle HI-Small [output folder]
"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import xgboost as xgb

from data.ibm_aml import load_transactions, primary_period, time_split
from data.paths import DATA_DIR

from .dataset import currency_medians, make_snapshots
from .features import BEHAVIOR_COLS, FEATURE_VERSION, GRAPH_COLS, STRUCTURE_COLS, TX_COLS
from .model import calibrated, fit_calibration, fit_model, score
from .neighbors import NEIGHBOR_COLS
from .ring_score import fit as fit_ring_scorer, purity
from .rings import detect_rings

ALL_COLS = TX_COLS + BEHAVIOR_COLS + GRAPH_COLS + STRUCTURE_COLS
TOP_FRACTION = 0.01  # share of accounts flagged before grouping into rings; chosen on val in ring_eval


@dataclass
class Bundle:
    model: xgb.Booster       # native booster, so serving does not need scikit-learn
    cols: list[str]
    threshold: float        # account score that maximized F1 on val
    top_fraction: float
    ccy_median: dict
    meta: dict
    calibration: tuple = (1.0, 0.0)  # Platt scaling (slope, intercept) on the model margin
    ring_scorer: dict | None = None  # learned ring score parameters (see ring_score.py)
    stage2: xgb.Booster | None = None  # optional second stage that also sees neighbors' stage-1 scores (ml/stack.py)
    high_quantile: float = 0.99        # what counts as a high-risk neighbor in stage 2

    @property
    def cols2(self) -> list[str]:
        return self.cols + NEIGHBOR_COLS

    def stage1_scores(self, all_X: pd.DataFrame):
        """Stage-1 probabilities for every account (stage 2 summarizes these around each account)."""
        return self.model.predict(xgb.DMatrix(all_X[self.cols]))

    def margin(self, X: pd.DataFrame):
        """Raw model output (log-odds) for each row of X."""
        return self.model.predict(xgb.DMatrix(X[self.cols]), output_margin=True)


def save_bundle(b: Bundle, folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    b.model.save_model(folder / "model.json")
    if b.stage2 is not None:
        b.stage2.save_model(folder / "model_stage2.json")
    (folder / "meta.json").write_text(json.dumps(
        {"cols": b.cols, "threshold": b.threshold, "top_fraction": b.top_fraction,
         "ccy_median": b.ccy_median, "meta": b.meta, "calibration": list(b.calibration),
         "ring_scorer": b.ring_scorer, "two_stage": b.stage2 is not None, "high_quantile": b.high_quantile}, indent=2),
        encoding="utf-8")


def load_bundle(folder: Path) -> Bundle:
    m = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    model = xgb.Booster()
    model.load_model(folder / "model.json")
    stage2 = None
    if m.get("two_stage"):
        stage2 = xgb.Booster()
        stage2.load_model(folder / "model_stage2.json")
    return Bundle(model, m["cols"], m["threshold"], m["top_fraction"], m["ccy_median"], m["meta"],
                  tuple(m.get("calibration", (1.0, 0.0))), m.get("ring_scorer"), stage2, m.get("high_quantile", 0.99))


def train_bundle(variant: str = "HI-Small", two_stage: bool = True) -> Bundle:
    """Train the model folder. Two-stage (the default) adds the neighbor-score second stage of ml/stack.py."""
    from .ablation import best_f1_threshold  # scikit-learn is only needed for training, not serving
    snaps = make_snapshots(variant)
    tx = primary_period(load_transactions(variant), variant)
    split = time_split(tx)
    meta = {"variant": variant, "feature_version": FEATURE_VERSION, "train_cutoff": str(snaps["train"].cutoff),
            "val_cutoff": str(snaps["val"].cutoff), "trained_at": pd.Timestamp.now().isoformat(timespec="seconds")}
    if two_stage:
        from .stack import fit_stacked

        stacked = fit_stacked(snaps["train"], snaps["val"], ALL_COLS)
        val_scores = stacked.score(snaps["val"])
        model, stage2, calibration = stacked.stage1.get_booster(), stacked.stage2.get_booster(), stacked.calibration
        meta["trees"], meta["trees_stage2"] = int(stacked.stage1.best_iteration + 1), int(stacked.stage2.best_iteration + 1)
    else:
        fitted = fit_model(snaps["train"], snaps["val"], ALL_COLS)
        calibration = fit_calibration(fitted, snaps["val"], ALL_COLS)
        val_scores = score(fitted, snaps["val"], ALL_COLS, calibration)
        model, stage2 = fitted.get_booster(), None
        meta["trees"] = int(fitted.best_iteration + 1)
    val_rings = detect_rings(val_scores, tx[tx["ts"] <= snaps["val"].cutoff], TOP_FRACTION)
    val_positive = set(snaps["val"].y.index[snaps["val"].y == 1])
    ring_scorer = fit_ring_scorer(val_rings, purity(val_rings, val_positive) >= 0.5)
    meta["val_rings"] = len(val_rings)
    return Bundle(model, ALL_COLS, best_f1_threshold(snaps["val"].y, val_scores), TOP_FRACTION,
                  currency_medians(tx[split == "train"]), meta, calibration, ring_scorer, stage2)


if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / variant
    bundle = train_bundle(variant)
    save_bundle(bundle, out)
    stage = f" + stage 2 ({bundle.meta['trees_stage2']} trees)" if bundle.stage2 is not None else ""
    print(f"saved {len(bundle.cols)}-feature model ({bundle.meta['trees']} trees{stage}) to {out}")
