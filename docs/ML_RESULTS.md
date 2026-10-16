# ML results

Everything here was measured by running the code in `ml/`. Nothing is projected. Where a number is weak, it is shown anyway.

All pig-butchering claims are **not yet tested**: the datasets below hold general laundering patterns, and the injected pig-butchering rings (data workstream) were not available when these runs were made.

## What was built

| Piece | File |
|---|---|
| Label and time rule (no look-ahead) | `ml/PROTOCOL.md` |
| 48 account features (transaction, behavioral, graph, structure) | `ml/features.py` |
| XGBoost, calibration, ablation | `ml/model.py`, `ml/ablation.py` |
| Rings: top accounts, linked by payments, Louvain split to at most 40 | `ml/rings.py` |
| Learned ring score | `ml/ring_score.py` |
| Explanations (exact TreeSHAP from XGBoost) | `ml/explain.py` |
| Model folder (model, thresholds, calibration, ring scorer) | `ml/bundle.py` |
| Functions the API calls | `ml/service.py`, `ml/api_backend.py` |

## 1. Do graph features help? Account level

IBM AML data, test window, PR-AUC (higher is better). Random guessing scores the fraud rate, 0.005 for HI-Small and 0.003 for LI-Small.

| Features | HI-Small (laptop) | HI-Small (Kaggle) | LI-Small (Kaggle) |
|---|---|---|---|
| Transaction-only | 0.113 | 0.110 | 0.042 |
| + behavioral (timing, pass-through) | 0.116 | 0.116 | 0.040 |
| + graph (neighbors, PageRank, 2-hop) | 0.142 | 0.135 | 0.054 |
| + k-core, clustering, components | 0.150 | 0.160 | 0.055 |

- **Graph features give a consistent gain of about 20 to 30%** over transaction-only, and it reproduced on a second machine. Over 5 training seeds the HI-Small graph model scored 0.141 ± 0.006 and transaction-only 0.113 ± 0.001, so the gain is larger than training noise.
- **The k-core, clustering and component features are not reliably useful.** They helped by 0.008 on the laptop and 0.025 on Kaggle, which is inside run-to-run variation.
- **Behavioral features add little** on this data. This may change with pig-butchering rings, where pass-through timing is the signature. That is untested.
- **Absolute accuracy is low.** On HI-Small the best model has about 30% precision at about 20% recall. On the lower-fraud LI-Small it has about 5% precision. Do not describe this as a high-accuracy detector.

### A real graph that does not agree: Elliptic

Elliptic Bitcoin data (nodes are transactions, test steps 35 to 49):

| Features | PR-AUC |
|---|---|
| Local (93 features of the transaction) | 0.774 |
| + our graph features | 0.771 |
| + the dataset's own one-hop aggregates | 0.777 |

**On Elliptic, graph features add nothing.** The local features already carry the signal. Graph helps on the IBM data and not here, so the claim has to be "helps on account-level laundering networks", not "helps everywhere".

## 2. Do we find rings? Ring level

185 laundering groups from the IBM patterns file are active in the HI-Small test window. A group is recovered if one detected ring holds at least half of its accounts. Purity is the share of a ring's members that touch laundering. The share of accounts flagged was chosen on the validation window.

| Model | Rings found | Groups recovered | Mean purity | Real rings |
|---|---|---|---|---|
| Transaction-only (2% flagged) | 335 | 11.9% | 13.4% | 13.4% |
| Graph features (1% flagged) | 79 | **21.6%** | **43.6%** | **41.8%** |

- On the Kaggle replication the graph model recovered 32% of groups at 29% purity (2% flagged), so recovery is in a 20 to 30% range, not a fixed number.
- On LI-Small at 5% flagged: 25.4% recovered by the graph model against 6.8% for transaction-only, but purity is only 4.5%.
- **Most groups are still missed, and most detected rings are not pure.**

### Ring score

The first score (mean of the top three account scores) ranked real rings barely above chance. A logistic regression on ring size, density and member score spread, fitted on validation rings, ranks test rings better:

| Model | Average precision, old score | Average precision, learned | Share of rings that are real |
|---|---|---|---|
| Graph features, 1% flagged | 0.430 | **0.607** | 0.418 |
| Transaction-only, 2% flagged | 0.324 | 0.504 | 0.134 |

**Limits of the learned score:** it was fitted on only 54 validation rings. It favors small rings, since two of three accounts flagged is enough for a small ring to count as real, so the top of the list contains 3-account rings. A minimum ring size of 3 was best on both validation and test, so it was kept.

## 3. How soon do we catch a ring? Time-to-detection

The test window is replayed in 6-hour steps. At each step features, scores and rings are rebuilt from only the transactions up to that moment. 65 laundering groups start in the test window.

| Model | Groups detected | Median time to detection | 90th percentile |
|---|---|---|---|
| Transaction-only | 7 of 65 (11%) | 14.6 hours | 32.5 hours |
| Graph features | 13 of 65 (20%) | **4.9 hours** | 16.8 hours |

Every detected group was caught before its last payment. **80% of groups were not detected at all** within the window.

## 4. Speed on LinuxONE (s390x)

Measured on the datathon VM: RHEL 9.8, s390x (big-endian), 3 vCPUs, 7.5 GB RAM. Full rescore of the last 48 hours of HI-Small (862,792 transactions, 354,447 accounts), three runs:

| Step | Time |
|---|---|
| Build features | 1.8 to 1.9 s |
| Score 148,023 accounts and form 47 rings | 0.6 s |
| **Full rescore** | **2.4 to 2.5 s** |
| Score one account with explanation | 8.4 to 8.6 ms |
| Describe and explain all rings (once, then cached) | 7.9 to 8.0 s |
| Peak memory | 742 MB |

- **Predictions on s390x match the laptop** to within 9×10⁻¹⁶ over 300 rows, so the big-endian machine gives the same answers.
- This is a full recompute, not an incremental update. New transactions appear after the next rescore (a few seconds), not instantly. The cost grows with the history used: on the laptop, rebuilding features from all 5M transactions takes about 25 s.
- Models were trained elsewhere (laptop and Kaggle CPU). Only scoring runs on LinuxONE. No accelerator-specific gains are claimed or used.
- scikit-learn, SHAP and numba could not be built on the VM, so serving uses XGBoost's own explanations and no scikit-learn.

### Bounded-history alternative

A rolling protocol rebuilds features from only the last 48 hours (`ml/rolling.py`). Feature build took 4 s on average (8.5 s at most) on the laptop. Account-level PR-AUC was 0.249 (transaction-only), 0.273 (+ behavioral) and 0.291 (+ graph), measured on different test snapshots, so it is not directly comparable to section 1. Ring recovery was lower: 11% against 10% for transaction-only, with higher purity (65% against 50%). Use it if rebuild cost becomes a problem; it is not what the saved model uses.

## Caveats that apply to everything above

- Single time split per dataset. Seeds measure training noise, not split noise.
- The IBM groups are generic laundering patterns, not pig-butchering.
- HI-Small is a 10-day synthetic window. Test windows hold 1,000 to 2,000 positive accounts.
- Ring `total_amount` adds up amounts in several currencies and must not be shown as dollars.
- Roles (victim, collector, mule, cash-out) are guessed from position inside a ring. IBM data has no role labels, so they are not validated.
- Account age is not used, because IBM has no account open date.
