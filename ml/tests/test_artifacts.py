import json
from pathlib import Path

import numpy as np
import pandas as pd

from api.schemas import Alert, Ring, RingSummary
from ml.bundle import ALL_COLS, load_bundle

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts" / "HI-Small"


def test_committed_model_loads_and_matches_the_current_feature_list():
    bundle = load_bundle(ARTIFACTS)
    assert bundle.cols == ALL_COLS                      # retrain and recommit if features change
    assert bundle.payment is not None and 0 < bundle.top_fraction <= 0.05   # the committed model scores payments
    X = pd.DataFrame(np.zeros((2, len(ALL_COLS))), columns=ALL_COLS)
    assert bundle.margin(X).shape == (2,)


def test_committed_examples_are_valid_api_output():
    rings = json.loads((ARTIFACTS / "examples" / "rings.json").read_text())
    for r in rings:
        RingSummary(**r)
    for f in (ARTIFACTS / "examples").glob("ring_*.json"):
        Ring(**json.loads(f.read_text()))
    for a in json.loads((ARTIFACTS / "examples" / "alerts.json").read_text()):
        Alert(**a)
