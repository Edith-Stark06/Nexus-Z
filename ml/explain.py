"""SHAP explanations with analyst-readable labels. Uses XGBoost's built-in TreeSHAP."""
import numpy as np
import pandas as pd
import xgboost as xgb

LABELS = {
    "out_cnt": "Many payments sent", "in_cnt": "Many payments received",
    "out_sum": "Large total sent", "in_sum": "Large total received",
    "out_max": "Very large single payment sent", "in_max": "Very large single payment received",
    "out_mean": "Large average payment sent", "in_mean": "Large average payment received",
    "out_cv": "Uneven payment sizes", "out_in_ratio": "Sends out more than it receives",
    "self_share": "Many transfers to itself", "cross_ccy_share": "Often changes currency",
    "span_h": "Active over a long span", "velocity": "High payment velocity",
    "max_tx_per_hour": "Bursts of payments within an hour", "hours_active": "Active across many hours",
    "pt_min": "Fastest pass-through is very short", "pt_median": "Money leaves within minutes",
    "fast_out_share": "Money leaves within 15 minutes of arriving",
    "no_prior_in_share": "Sends money it never received",
    "n_out_cp": "Pays many different accounts", "n_in_cp": "Paid by many different accounts",
    "fan_in_ratio": "Many payers, few receivers", "repeat_out": "Repeat payments to the same accounts",
    "pagerank": "Central in the payment network",
    "out_nb_in_cp_mean": "Pays accounts that many others pay",
    "in_nb_out_cp_mean": "Paid by accounts that pay many others",
    "two_hop_out": "Wide reach two hops out", "two_hop_in": "Wide reach two hops in",
    "reciprocity": "Payments flow back and forth", "kcore": "Sits in a tightly connected core",
    "clustering": "Its neighbors also pay each other", "comp_size": "Part of a large connected group",
    "comp_avg_deg": "Densely connected group",
}


def label(feature: str) -> str:
    if feature in LABELS:
        return LABELS[feature]
    for prefix, text in (("out_share_", "Sends mostly by "), ("in_share_", "Receives mostly by ")):
        if feature.startswith(prefix):
            return text + feature[len(prefix):]
    return feature.replace("_", " ").capitalize()


def shap_values(model, X: pd.DataFrame) -> np.ndarray:
    """Exact TreeSHAP contribution per account and feature, in log-odds (positive pushes risk up).

    Computed by XGBoost itself, so no extra package is needed. Matches shap.TreeExplainer.
    """
    booster = model.get_booster() if hasattr(model, "get_booster") else model  # classifier or Booster
    contrib = booster.predict(xgb.DMatrix(X), pred_contribs=True)
    return contrib[:, :-1]  # the last column is the base value


def top_reasons(contrib: np.ndarray, cols: list[str], k: int = 5) -> list[dict]:
    order = np.argsort(-np.abs(contrib))[:k]
    return [{"feature": cols[i], "label": label(cols[i]), "contribution": round(float(contrib[i]), 3)}
            for i in order]
