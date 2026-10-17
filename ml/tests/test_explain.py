import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from ml.explain import label, shap_values, top_reasons


def fitted():
    rng = np.random.default_rng(1)
    X = pd.DataFrame(rng.normal(size=(300, 6)), columns=list("abcdef"))
    X.loc[::7, "c"] = np.nan  # XGBoost handles missing values, so the explanation must too
    y = ((X["a"] + 0.5 * X["b"].fillna(0)) > 0.3).astype(int)
    booster = xgb.train({"objective": "binary:logistic", "max_depth": 3, "tree_method": "hist", "seed": 0},
                        xgb.DMatrix(X, label=y), num_boost_round=25)
    return booster, X


def test_native_treeshap_matches_the_shap_package():
    shap = pytest.importorskip("shap")
    model, X = fitted()
    explainer = shap.TreeExplainer(model)
    ours = shap_values(model, X)
    assert np.allclose(ours, explainer.shap_values(X), atol=1e-4)
    margin = model.predict(xgb.DMatrix(X), output_margin=True)
    assert np.allclose(ours.sum(axis=1) + explainer.expected_value, margin, atol=1e-4)


def test_contributions_sum_to_the_model_margin_up_to_a_constant():
    model, X = fitted()
    offset = model.predict(xgb.DMatrix(X), output_margin=True) - shap_values(model, X).sum(axis=1)
    assert np.allclose(offset, offset[0], atol=1e-4)


def test_top_reasons_and_labels():
    reasons = top_reasons(np.array([0.1, -0.9, 0.4]), ["fan_in_ratio", "kcore", "out_share_ACH"], k=2)
    assert [r["feature"] for r in reasons] == ["kcore", "out_share_ACH"]
    assert reasons[0]["contribution"] == -0.9
    assert label("fan_in_ratio") == "Many payers, few receivers"
    assert label("out_share_Wire") == "Sends mostly by Wire"
    assert label("some_new_feature") == "Some new feature"


def test_calibration_shrinks_inflated_probabilities_and_keeps_order():
    from ml.model import calibrated

    margin = np.array([-3.0, 0.0, 3.0, 6.0])
    raw = 1 / (1 + np.exp(-margin))
    cal = calibrated(margin, (1.0, -5.0))
    assert (cal < raw).all() and (np.diff(cal) > 0).all() and cal[-1] < 0.8


def test_a_reason_is_marked_absent_when_its_label_is_not_true():
    from ml.explain import label_holds, top_reasons

    cols = ["d_self_share", "s_pt_median", "ch_ACH", "amount_norm", "hour"]
    contrib = np.array([1.5, 1.0, 0.9, 0.8, 0.7])
    typical = {"d_self_share": 0.0, "s_pt_median": 60.0, "ch_ACH": 1.0, "amount_norm": 1.0, "hour": 12.0}
    # no self-transfers, slow pass-through, not ACH, a large payment, and a feature with no direction
    values = np.array([0.0, 500.0, 0.0, 5.0, 3.0])
    out = {r["feature"]: r for r in top_reasons(contrib, cols, 5, values, typical)}
    assert out["d_self_share"]["label"].endswith("(absent)") and out["d_self_share"]["holds"] is False
    assert out["s_pt_median"]["holds"] is False          # the label says "within minutes", the value is slow
    assert out["ch_ACH"]["holds"] is False               # not paid by ACH: a one-hot is true only when it is 1
    assert out["amount_norm"]["holds"] is True and not out["amount_norm"]["label"].endswith("(absent)")
    assert out["hour"]["holds"] is None
    # and when the values do match the labels nothing is marked
    ok = top_reasons(contrib, cols, 5, np.array([0.4, 5.0, 1.0, 5.0, 3.0]), typical)
    assert [r["holds"] for r in ok] == [True, True, True, True, None]
    assert label_holds("s_pt_median", float("nan"), 60.0) is None   # no value, no claim


def test_reasons_without_values_are_unchanged():
    from ml.explain import top_reasons

    out = top_reasons(np.array([0.5, -2.0]), ["out_cnt", "self_share"], 2)
    assert [r["label"] for r in out] == ["Many transfers to itself", "Many payments sent"] and "holds" not in out[0]
