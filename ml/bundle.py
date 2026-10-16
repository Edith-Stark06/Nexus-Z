"""The trained model plus everything needed to score with it, saved as a folder.

Usage (from the repo root):  python -m ml.bundle HI-Small [output folder]
"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from xgboost import XGBClassifier

from data.ibm_aml import load_transactions, primary_period, time_split
from data.paths import DATA_DIR

from .dataset import currency_medians, make_snapshots
from .features import BEHAVIOR_COLS, FEATURE_VERSION, GRAPH_COLS, STRUCTURE_COLS, TX_COLS
from .model import fit_calibration, fit_model, score

ALL_COLS = TX_COLS + BEHAVIOR_COLS + GRAPH_COLS + STRUCTURE_COLS
TOP_FRACTION = 0.02  # share of accounts flagged before grouping into rings; chosen on val in ring_eval


@dataclass
class Bundle:
    model: XGBClassifier
    cols: list[str]
    threshold: float        # account score that maximized F1 on val
    top_fraction: float
    ccy_median: dict
    meta: dict
    calibration: tuple = (1.0, 0.0)  # Platt scaling (slope, intercept) on the model margin


def save_bundle(b: Bundle, folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    b.model.save_model(folder / "model.json")
    (folder / "meta.json").write_text(json.dumps(
        {"cols": b.cols, "threshold": b.threshold, "top_fraction": b.top_fraction,
         "ccy_median": b.ccy_median, "meta": b.meta, "calibration": list(b.calibration)}, indent=2),
        encoding="utf-8")


def load_bundle(folder: Path) -> Bundle:
    m = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    model = XGBClassifier()
    model.load_model(folder / "model.json")
    return Bundle(model, m["cols"], m["threshold"], m["top_fraction"], m["ccy_median"], m["meta"],
                  tuple(m.get("calibration", (1.0, 0.0))))


def train_bundle(variant: str = "HI-Small") -> Bundle:
    from .ablation import best_f1_threshold  # scikit-learn is only needed for training, not serving
    snaps = make_snapshots(variant)
    tx = primary_period(load_transactions(variant), variant)
    split = time_split(tx)
    model = fit_model(snaps["train"], snaps["val"], ALL_COLS)
    calibration = fit_calibration(model, snaps["val"], ALL_COLS)
    val_scores = score(model, snaps["val"], ALL_COLS, calibration)
    meta = {"variant": variant, "feature_version": FEATURE_VERSION, "trees": int(model.best_iteration + 1),
            "train_cutoff": str(snaps["train"].cutoff), "val_cutoff": str(snaps["val"].cutoff),
            "trained_at": pd.Timestamp.now().isoformat(timespec="seconds")}
    return Bundle(model, ALL_COLS, best_f1_threshold(snaps["val"].y, val_scores), TOP_FRACTION,
                  currency_medians(tx[split == "train"]), meta, calibration)


if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / variant
    bundle = train_bundle(variant)
    save_bundle(bundle, out)
    print(f"saved {len(bundle.cols)}-feature model ({bundle.meta['trees']} trees) to {out}")
