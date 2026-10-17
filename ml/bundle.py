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
# Share of accounts flagged before grouping into rings, per scorer; chosen on validation ring recovery and purity.
TOP_FRACTIONS = {"payment": 0.0025, "two_stage": 0.01, "account": 0.01}
# Wider net rings may grow into, from ring_grow_eval on validation: strict 0.25% with growth to 2% beat no growth
# on recovery times purity. Trading some purity for recovery is a dial, see docs/ML_RESULTS.md.
GROW_FRACTIONS = {"payment": 0.02, "two_stage": None, "account": None}


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
    payment: xgb.Booster | None = None  # payment-level model (ml/edge_model.py); when present it is the scorer
    payment_calibration: tuple = (1.0, 0.0)
    grow_fraction: float | None = None  # wider top share rings may grow into (see detect_rings); None means no growth
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
    if b.payment is not None:
        b.payment.save_model(folder / "model_payment.json")
    (folder / "meta.json").write_text(json.dumps(
        {"cols": b.cols, "threshold": b.threshold, "top_fraction": b.top_fraction,
         "ccy_median": b.ccy_median, "meta": b.meta, "calibration": list(b.calibration),
         "ring_scorer": b.ring_scorer, "two_stage": b.stage2 is not None, "high_quantile": b.high_quantile,
         "payment": b.payment is not None, "payment_calibration": list(b.payment_calibration),
         "grow_fraction": b.grow_fraction}, indent=2),
        encoding="utf-8")


def load_bundle(folder: Path) -> Bundle:
    m = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    model = xgb.Booster()
    model.load_model(folder / "model.json")
    stage2 = None
    if m.get("two_stage"):
        stage2 = xgb.Booster()
        stage2.load_model(folder / "model_stage2.json")
    payment = None
    if m.get("payment"):
        payment = xgb.Booster()
        payment.load_model(folder / "model_payment.json")
    return Bundle(model=model, cols=m["cols"], threshold=m["threshold"], top_fraction=m["top_fraction"],
                  ccy_median=m["ccy_median"], meta=m["meta"], calibration=tuple(m.get("calibration", (1.0, 0.0))),
                  ring_scorer=m.get("ring_scorer"), stage2=stage2, high_quantile=m.get("high_quantile", 0.99),
                  payment=payment, payment_calibration=tuple(m.get("payment_calibration", (1.0, 0.0))),
                  grow_fraction=m.get("grow_fraction"))


def train_bundle(variant: str = "HI-Small", scorer: str = "payment") -> Bundle:
    """Train the model folder.

    scorer "payment" (default): a payment-level model; an account's risk is its riskiest payment (ml/edge_model.py).
    scorer "two_stage": the account model plus a second stage that sees neighbors' scores (ml/stack.py).
    scorer "account": the plain account model. The plain account model is always trained and saved as well.
    """
    from .ablation import best_f1_threshold  # scikit-learn is only needed for training, not serving
    assert scorer in TOP_FRACTIONS, scorer
    snaps = make_snapshots(variant)
    tx = primary_period(load_transactions(variant), variant)
    split = time_split(tx)
    ccy = currency_medians(tx[split == "train"])
    meta = {"variant": variant, "feature_version": FEATURE_VERSION, "scorer": scorer,
            "train_cutoff": str(snaps["train"].cutoff), "val_cutoff": str(snaps["val"].cutoff),
            "trained_at": pd.Timestamp.now().isoformat(timespec="seconds")}
    fitted = fit_model(snaps["train"], snaps["val"], ALL_COLS)
    calibration = fit_calibration(fitted, snaps["val"], ALL_COLS)
    meta["trees"] = int(fitted.best_iteration + 1)
    model, stage2, payment, payment_calibration = fitted.get_booster(), None, None, (1.0, 0.0)
    if scorer == "payment":
        from .edge_model import account_scores, fit_payment_model

        pay_model, payment_calibration, p_val = fit_payment_model(tx, split, snaps, ALL_COLS, ccy)
        val_window = tx[split == "val"].reset_index(drop=True)
        val_scores = account_scores(val_window, p_val).reindex(snaps["val"].X.index).fillna(0.0)
        payment, meta["trees_payment"] = pay_model.get_booster(), int(pay_model.best_iteration + 1)
    elif scorer == "two_stage":
        from .stack import fit_stacked

        stacked = fit_stacked(snaps["train"], snaps["val"], ALL_COLS)
        val_scores = stacked.score(snaps["val"])
        stage2, calibration = stacked.stage2.get_booster(), stacked.calibration
        model, meta["trees"] = stacked.stage1.get_booster(), int(stacked.stage1.best_iteration + 1)
        meta["trees_stage2"] = int(stacked.stage2.best_iteration + 1)
    else:
        val_scores = score(fitted, snaps["val"], ALL_COLS, calibration)
    top_fraction = TOP_FRACTIONS[scorer]
    grow_fraction = GROW_FRACTIONS[scorer]
    val_rings = detect_rings(val_scores, tx[tx["ts"] <= snaps["val"].cutoff], top_fraction, grow_fraction=grow_fraction)
    val_positive = set(snaps["val"].y.index[snaps["val"].y == 1])
    ring_scorer = fit_ring_scorer(val_rings, purity(val_rings, val_positive) >= 0.5)
    meta["val_rings"] = len(val_rings)
    return Bundle(model=model, cols=ALL_COLS, threshold=best_f1_threshold(snaps["val"].y, val_scores),
                  top_fraction=top_fraction, ccy_median=ccy, meta=meta, calibration=calibration,
                  ring_scorer=ring_scorer, stage2=stage2, payment=payment, payment_calibration=payment_calibration,
                  grow_fraction=grow_fraction)


if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / variant
    chosen = sys.argv[3] if len(sys.argv) > 3 else "payment"
    bundle = train_bundle(variant, chosen)
    save_bundle(bundle, out)
    extra = "".join(f", {k.replace('trees_', '')} {v} trees" for k, v in bundle.meta.items() if k.startswith("trees_"))
    print(f"saved {len(bundle.cols)}-feature {chosen} model (account model {bundle.meta['trees']} trees{extra}) to {out}")
