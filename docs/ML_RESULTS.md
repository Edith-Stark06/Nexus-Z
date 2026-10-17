# ML results

Everything here was measured by running the code in `ml/`. Nothing is projected. Where a number is weak, it is shown anyway.

Sections 1 to 4 use general laundering data (IBM AML, Elliptic). Pig-butchering rings are only tested in section 5, on **stand-in rings written by the modelling side**, because the data workstream's generator was not available. Treat section 5 with the circularity caution given there.

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

- **Graph features give a consistent gain of about 20 to 30%** over transaction-only, and it reproduced on a second machine and at 6 times the size (below). Over 5 training seeds the HI-Small graph model scored 0.141 ± 0.006 and transaction-only 0.113 ± 0.001, so the gain is larger than training noise.
- **The k-core, clustering and component features are not reliably useful.** They helped by 0.008 on the laptop and 0.025 on Kaggle, which is inside run-to-run variation.
- **Behavioral features add little** on this data. This may change with pig-butchering rings, where pass-through timing is the signature. That is untested.
- **Absolute accuracy is low.** On HI-Small the best model has about 30% precision at about 20% recall. On the lower-fraud LI-Small it has about 5% precision. Do not describe this as a high-accuracy detector.

### At 6 times the size: HI-Medium

32M transactions and 2M accounts, run on a Kaggle CPU notebook (about 30 minutes for the ablation, 20 minutes for the ring evaluation, 4 vCPUs). Test window: 9,253 positive accounts.

| Features | PR-AUC |
|---|---|
| Transaction-only | 0.122 |
| + behavioral | 0.114 |
| + graph | **0.158** |
| + k-core, clustering, components | 0.152 |

The graph gain holds at scale (+30%). Ring level at 1% flagged: 24.2% of groups recovered by the graph model against 11.0% for transaction-only, with 31.6% of detected rings real against 19.9%. The learned ring score added nothing at this scale for the graph model (average precision 0.381 with the old score, 0.381 with the learned one), though it helped transaction-only (0.315 to 0.369).

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

- On the Kaggle replication the graph model recovered 32% of groups at 29% purity (2% flagged), so recovery is in a 20 to 30% range, not a fixed number. Transaction-only is also not fixed: on the Kaggle and LinuxONE runs the setting chosen on validation was 0.5% flagged and it recovered only 3% of groups, against 12% on the laptop run above. Report it as 3 to 12%.
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
- The committed model was trained on this VM (next section). Earlier experiments ran on a laptop and on Kaggle CPU notebooks. No accelerator-specific gains are claimed or used.
- scikit-learn, SHAP and numba could not be built on the VM's own Python environment, so serving uses XGBoost's own explanations and no scikit-learn. Training uses the platform container, which does include scikit-learn.

### Trained and evaluated on LinuxONE

The model was trained inside the platform's Jupyter Lab container on the same VM (s390x, 3 vCPUs, 7.5 GB RAM, CPU only; see `ml/LINUXONE.md`). This is the model committed in `ml/artifacts/HI-Small`.

| Job on the VM (HI-Small) | Time |
|---|---|
| Train the model folder (features for three windows, XGBoost, calibration, ring scorer) | 149 s |
| Account-level ablation (four feature sets) | 160 s |
| Ring-level evaluation | 142 s |
| Full rescore of the last 48 hours (862,792 transactions) | 2.3 s, 5.4 ms per account with explanation, peak 786 MB |

- **The account-level ablation on the VM matches the Kaggle run exactly**, row for row (PR-AUC 0.110, 0.116, 0.135, 0.160; same tree counts, same precision and recall). Two different machines running the same library versions gave the same answer. The laptop differs slightly (0.113, 0.116, 0.142, 0.150) because its library versions are newer, so small differences between a laptop run and a Kaggle or VM run are expected.
- Memory stayed above 4 GB free during training.
- Ring level on the VM (flagged fraction chosen on validation): the graph model recovered 30.3% of groups at 29.2% purity (2% flagged), within the 20 to 30% range seen on the laptop and Kaggle.
- CPU only. No on-chip AI accelerator is used, so no accelerator gains are claimed.

### Bounded-history alternative

A rolling protocol rebuilds features from only the last 48 hours (`ml/rolling.py`). Feature build took 4 s on average (8.5 s at most) on the laptop. Account-level PR-AUC was 0.249 (transaction-only), 0.273 (+ behavioral) and 0.291 (+ graph), measured on different test snapshots, so it is not directly comparable to section 1. Ring recovery was lower: 11% against 10% for transaction-only, with higher purity (65% against 50%). Use it if rebuild cost becomes a problem; it is not what the saved model uses.

## 5. Pig-butchering-shaped rings (stand-in data, read with care)

`ml/standin_rings.py` injects 90 pig-butchering rings and 90 legitimate look-alikes into the HI-Small transactions. Rings come in four shapes (fan-in, dispersed, slow, chain); victims are real background accounts; fraud accounts are new accounts. The look-alikes are merchants, payroll runs, landlords and charities, none of them labelled fraud. Channels and amounts are drawn from the background data so a single payment carries no tell. Models are trained on the combined labels. Three different injections (seeds), each tested on its own test window (about 200 fraud accounts and 70 look-alike hub accounts each):

| Features | Injected-fraud PR-AUC, seeds 0 / 1 / 2 | Legitimate hubs wrongly flagged (of about 70) |
|---|---|---|
| Transaction-only | 0.19 / 0.18 / 0.21 | 7 / 4 / 6 |
| + behavioral (timing) | 0.71 / 0.66 / **0.12** | 0 / 0 / 1 |
| + graph | 0.59 / 0.64 / 0.74 | 0 / 2 / 0 |
| + k-core, clustering, components | 0.65 / 0.59 / 0.61 | 0 / 4 / 1 |

- **Timing and structure matter a lot here.** Transaction-only never gets above 0.21, while models that see timing or structure reach 0.6 to 0.7 in most runs. Money that arrives and leaves within minutes is the signal this data was built around.
- **The results are not stable across injections.** The timing-only model collapsed in one seed (0.12). The model with graph features was steadier (0.59 to 0.74). The data supports "timing or structure helps", not "this feature set is best".
- **Look-alike hubs are rarely flagged** by models that see timing or structure (0 to 4 of about 70), against 4 to 7 for transaction-only. Payroll, which also passes money through quickly, was included on purpose.

Ring level, flagged fraction chosen on validation: the graph model recovered 96%, 92% and 87% of injected rings; transaction-only recovered 84%, 88% and 87%. Real-ring share was 57% to 65% against 51% to 60%. **These recovery numbers are high because the injected rings are easy and were written by the same side that wrote the features.** Even transaction-only recovers most of them, so this test does not show that ring grouping beats per-account scoring. It does show that a pig-butchering-shaped flow is detectable at all, and that look-alike hubs do not swamp the alerts.

What would make this convincing: rings from an independent generator, more varied timing (including rings that deliberately delay forwarding), and real or adversarially built look-alikes.

## 6. Better models: payment-level scoring, two stages, ring growth

Sections 1 to 4 describe the first model, which scores accounts. Later work on HI-Small (all on the LinuxONE VM, same time split and protocol, 3 training seeds each) tried three improvements. Test window, account level, PR-AUC:

| Model | PR-AUC | Precision | Recall | PR-AUC on accounts never flagged before |
|---|---|---|---|---|
| Account model (graph, structure features) | 0.153 (0.147 to 0.160) | 0.30 | 0.20 | 0.18 |
| **Two-stage account model** (a second stage that also sees the first stage's scores for each account's payers and payees) | 0.184 (0.180 to 0.189) | 0.35 | 0.28 | 0.26 |
| **Payment-level model** (score every payment; an account's risk is its riskiest payment) | **0.428** (0.425 to 0.432) | **0.74** (0.66 to 0.80) | **0.31** | **0.39** |

Precision and recall are at the threshold that maximized F1 on validation. At payment level the model scores 0.434 PR-AUC where chance is 0.0011.

**The payment-level model is the one in the committed bundle.** Each payment is described by its own amount, channel, hour and currency change; by how soon the sender received money before sending it (and how much), and how soon the receiver passes it on; and by the account features of both endpoints. The gain over the account model is large and steady across seeds. Training keeps every laundering payment and 5% of the rest.

### Rings from the payment model

Laundering groups recovered, rings that are real, and mean purity, test window, with the settings chosen on validation (strict share of accounts that may start a ring; wider share a ring may grow into):

| Rings formed from | Groups recovered | Rings that are real | Mean purity |
|---|---|---|---|
| Account model, no growth | 20 to 30% | 31 to 46% | 29 to 44% |
| Two-stage account model, no growth | 42% | 40% | 36% |
| Payment model, strict 0.5%, no growth | 25 to 27% | 82 to 88% | 75 to 81% |
| Payment model, strict 0.25%, no growth | 23% | 98% | 92% |
| **Payment model, strict 0.25%, grown to 2% (committed setting)** | **34%** | **70%** | **62%** |
| Payment model, strict 0.25%, grown to 5% | 35% | 46% | 42% |

Growth is a dial between catching more of each group and keeping rings clean. The committed setting recovers a third of the laundering groups with seven in ten rings real. Without growth the rings are almost all real but a fifth of the groups are found. The validation-chosen setting also holds on test.

### What did not help

- **Burst and motif features** (distinct payers within an hour, six hours or a day; directed triangles; feed-forward loops; repeated amounts): PR-AUC 0.149 against 0.160 without them. Not adopted.

### Caveats specific to this section

- One dataset (IBM AML HI-Small), one time split, three training seeds. Seeds measure training noise, not split noise. The strict 0.25% rows and the growth rows in the rings table are from seed 0 only; the other payment-model and account-model ring figures are ranges over the three seeds.
- The payment model looks at payments in a window together with the history up to the cutoff, including the receiver's next payment. A payment is therefore flagged once the evidence appears (for example when the money is forwarded), which is why detection time is replayed separately.
- Precision and recall are at one validation-chosen threshold; other thresholds trade them off.

## Caveats that apply to everything above

- Single time split per dataset. Seeds measure training noise, not split noise.
- The IBM groups are generic laundering patterns, not pig-butchering. Section 5 covers pig-butchering only on stand-in data.
- HI-Small is a 10-day synthetic window. Test windows hold 1,000 to 2,000 positive accounts.
- Ring `total_amount` adds up amounts in several currencies and must not be shown as dollars.
- Roles (victim, collector, mule, cash-out) are guessed from position inside a ring. IBM data has no role labels, so they are not validated.
- Account age is not used, because IBM has no account open date.
