import numpy as np
import pandas as pd
import pytest
from xgboost import XGBClassifier

from ml.explain import label, shap_values, top_reasons


def fitted():
    rng = np.random.default_rng(1)
    X = pd.DataFrame(rng.normal(size=(300, 6)), columns=list("abcdef"))
    X.loc[::7, "c"] = np.nan  # XGBoost handles missing values, so the explanation must too
    y = ((X["a"] + 0.5 * X["b"].fillna(0)) > 0.3).astype(int)
    return XGBClassifier(n_estimators=25, max_depth=3, tree_method="hist", random_state=0).fit(X, y), X


def test_native_treeshap_matches_the_shap_package():
    shap = pytest.importorskip("shap")
    model, X = fitted()
    explainer = shap.TreeExplainer(model)
    ours = shap_values(model, X)
    assert np.allclose(ours, explainer.shap_values(X), atol=1e-4)
    margin = model.predict(X, output_margin=True)
    assert np.allclose(ours.sum(axis=1) + explainer.expected_value, margin, atol=1e-4)


def test_contributions_sum_to_the_model_margin_up_to_a_constant():
    model, X = fitted()
    offset = model.predict(X, output_margin=True) - shap_values(model, X).sum(axis=1)
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
