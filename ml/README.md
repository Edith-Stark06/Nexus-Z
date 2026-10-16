# ml/: graph features, models, rings

Results and caveats: [docs/ML_RESULTS.md](../docs/ML_RESULTS.md). The no-look-ahead rule: [PROTOCOL.md](PROTOCOL.md).

## For the API (platform)

`ml/api_backend.py` has `ModelBackend`, which implements the `Backend` protocol in `api/backend.py` with real model output. To switch the API from sample data, make `get_backend()` return:

```python
from ml.api_backend import ModelBackend
ModelBackend.from_dir(bundle_folder, transactions_dataframe)
```

- `bundle_folder` holds `model.json` and `meta.json`, made by `python -m ml.bundle HI-Small`.
- `transactions_dataframe` is the recent history. Load it with `data.ibm_aml.load_transactions`. Columns needed: `ts, src, dst, amount, currency, receiving_currency, channel`.
- New transactions go in through `ingest`. They show up after the next rebuild, at most once every `min_refresh_seconds`. A rebuild recomputes everything, so measure `backend.refresh_seconds`.
- Needs only numpy, scipy, pandas, networkx, xgboost and pydantic. scikit-learn and SHAP are not required.

The functions behind it are in `ml/service.py`: `score_account`, `get_ring`, `explain`, `list_rings`, `list_alerts`. Each returns a dict shaped like `api/schemas.py`.

## For the data workstream

- `ml/PROTOCOL.md` says how train, val and test are cut. Metrics should follow the same rule.
- `python -m ml.ring_eval HI-Small` measures ring recovery and purity against laundering patterns. For injected rings, replace the pattern loader with the ring ground truth; `evaluate` only needs a list of `{first_ts, last_ts, accounts}`.
- Injected rings can be added to the transactions before `build_features` runs. Nothing else needs to change.

## Commands (from the repo root)

| Command | What it does |
|---|---|
| `python -m ml.ablation HI-Small` | Compare feature sets at account level |
| `python -m ml.ring_eval HI-Small` | Ring recovery, purity, ring score ranking |
| `python -m ml.detection_time HI-Small` | Replay the test window, measure time-to-detection |
| `python -m ml.rolling HI-Small` | Fixed 48-hour history protocol |
| `python -m ml.elliptic` | Graph features on the Elliptic data |
| `python -m ml.bundle HI-Small [folder]` | Train and save the model folder |
| `python -m ml.export_scores HI-Small` | Write real model output as API-shaped JSON |
| `python -m ml.latency_check time BUNDLE SLICE` | Time a full rescore on this machine |
| `python -m pytest ml/tests api/tests -q` | Tests |

Heavy runs should use Kaggle: see [KAGGLE.md](KAGGLE.md).
