# ML results

Everything here was measured by running the code in `ml/`. Nothing is projected. Where a number is weak, it is shown anyway.

Sections 1 to 4 use general laundering data (IBM AML, Elliptic). Pig-butchering rings are tested in sections 5 and 7: section 5 on **stand-in rings written by the modelling side**, section 7 on the generator `data/rings.py` written by the data side; both are our own team's simulations. Treat both with the circularity caution given there.

## What was built

| Piece | File |
|---|---|
| Label and time rule (no look-ahead) | `ml/PROTOCOL.md` |
| 57 account features (transaction, timing, graph, structure, burst and motif; the payment model takes 130 inputs: 16 about the payment and its flow plus the 57 account features of each endpoint) | `ml/features.py` |
| XGBoost, calibration, ablation | `ml/model.py`, `ml/ablation.py` |
| Rings: top accounts, linked by payments, optionally grown through weaker accounts, Louvain split to at most 40 | `ml/rings.py` |
| Payment-level model: each payment scored, an account takes its riskiest payment | `ml/edge_model.py` |
| Two-stage account model (neighbors' scores) | `ml/stack.py`, `ml/neighbors.py` |
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

The test window is replayed in 6-hour steps through the same `Scorer` the API serves. At each step it is given only the transactions up to that moment and scores the accounts active in the last 24 hours. 65 laundering groups start in the test window. A group counts as detected at the first step where one detected ring holds at least half of its accounts seen so far.

**The committed model** (payment level, run on the LinuxONE VM, compared with the account model inside the same folder):

| Model | Groups detected | Median time to detection | 90th percentile |
|---|---|---|---|
| Account model | 13 of 65 (20%) | 10.4 hours | 21.8 hours |
| **Payment model with ring growth (committed)** | **36 of 65 (55%)** | 9.7 hours | 21.9 hours |

The payment model finds almost three times as many groups, at about the same delay. 52% of groups were caught before their last payment. **45% were not detected at all** within the window. Median time to detection is measured only on the groups that were detected.

Earlier replay with the first account model (laptop, before the payment model existed): graph features detected 13 of 65 (20%) at a median of 4.9 hours, transaction-only 7 of 65 (11%) at 14.6 hours. The two median figures are not comparable, since the 4.9 hours is for 13 groups and the 9.7 hours is for 36.

## 4. Speed on LinuxONE (s390x)

Measured on the datathon VM: RHEL 9.8, s390x (big-endian), 3 vCPUs, 7.5 GB RAM.

### Scaling of the committed model (payment level)

Full rescore (features for every account from the last N hours of history, plus scoring the payments of the last 24 hours and forming rings), measured by `ml/scaling_check.py` with nothing else running:

| History used | Transactions | Total time | Throughput | Rings |
|---|---|---|---|---|
| 6 hours | 48,163 | 0.28 s | 170,000 tx/s | 3 |
| 12 hours | 95,775 | 0.55 s | 174,000 tx/s | 21 |
| 24 hours | 208,325 | 1.17 s | 179,000 tx/s | 55 |
| 48 hours | 862,792 | 3.22 s | 268,000 tx/s | 53 |
| 96 hours | 1,828,316 | 5.65 s | 324,000 tx/s | 57 |
| 192 hours | 3,207,867 | 9.34 s | 344,000 tx/s | 61 |
| all (10 days) | 5,077,237 | 15.65 s | 324,000 tx/s | 60 |

Time grows roughly in step with the history used, and the peak memory stayed at 1.8 GB up to 96 hours, 2.3 GB at 192 hours and 2.7 GB for the whole file, inside the VM's 7.5 GB. The rings counted depend on the window, since only accounts active in the last 24 hours are flagged.

Cores: XGBoost with 200 trees on the same data took 18.6 s on one thread, 12.7 s on two and 9.5 s on three (a 2.0 times speed-up on this run; an earlier run with 48 features measured 2.8 times). Scoring 356,260 accounts took 1.75 s on one thread and 0.60 s on three (2.9 times, about 590,000 accounts per second). Training speed-up varied between runs, so quote it as 2.0 to 2.8 times.

### Earlier measurement with the first (account-level) model

Full rescore of the last 48 hours of HI-Small (862,792 transactions, 354,447 accounts), three runs:

| Step | Time |
|---|---|
| Build features | 1.8 to 1.9 s |
| Score 148,023 accounts and form 47 rings | 0.6 s |
| **Full rescore** | **2.4 to 2.5 s** |
| Score one account with explanation | 8.4 to 8.6 ms |
| Describe and explain all rings (once, then cached) | 7.9 to 8.0 s |
| Peak memory | 742 MB |

- **Predictions on s390x match the laptop** to within 9×10⁻¹⁶ over 300 rows, so the big-endian machine gives the same answers.
- This is a full recompute, not an incremental update. New transactions appear after the next rescore: about ten seconds when the machine is idle and up to about thirty-six while payments stream in (PLATFORM_RESULTS.md 3c), not instantly. The cost grows with the history used: on the laptop, rebuilding features from all 5M transactions takes about 25 s.
- The committed model was trained on this VM (next section). Earlier experiments ran on a laptop and on Kaggle CPU notebooks. No accelerator-specific gains are claimed or used.
- scikit-learn, SHAP and numba could not be built on the VM's own Python environment, so serving uses XGBoost's own explanations and no scikit-learn. Training uses the platform container, which does include scikit-learn.

### Trained and evaluated on LinuxONE

The model was trained inside the platform's Jupyter Lab container on the same VM (s390x, 3 vCPUs, 7.5 GB RAM, CPU only; see `ml/LINUXONE.md`). This is the model committed in `ml/artifacts/HI-Small`.

**The committed payment-level model** (57 features; an account model of 374 trees and a payment model of 358 trees): training the whole folder took 882 s (14.7 minutes), the 6-hour-step replay 357 s, exporting the real examples 191 s, and the scaling benchmark 107 s. Everything in this subsection below describes the first, account-level model.

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

What would make this convincing: rings from an independent generator, more varied timing (including rings that deliberately delay forwarding), and real or adversarially built look-alikes. The next subsection is a first step; the generator is still ours.

### A second generator with varied timing and adversarial look-alikes

Verona wrote `data/rings.py`: 8 ring shapes (including batched, delayed, split and mixed-speed forwarding, and rings whose accounts already have ordinary history) and 5 look-alike types (merchant, payroll, landlord, charity, new customer), each look-alike adversarial (fast pass-through) with probability 0.5. Evaluated with the independent harness `python -m eval.run` (metrics checked against scikit-learn), 3 seeds, test window, account models only. Full tables and six robustness scenarios: [eval/results/RESULTS.md](../eval/results/RESULTS.md).

| Features | PR-AUC, injected fraud accounts | Rings recovered |
|---|---|---|
| Transaction-only | 0.179 ± 0.013 | 0.616 ± 0.056 |
| + behavioral (timing) | 0.413 ± 0.042 | 0.639 ± 0.168 |
| + graph | 0.362 ± 0.033 | 0.736 ± 0.087 |
| + k-core, clustering, components | 0.407 ± 0.010 | 0.727 ± 0.142 |
| + bursts and motifs | 0.396 ± 0.025 | 0.704 ± 0.076 |

- **Most of the gain over transaction-only comes from timing features.** Graph features add nothing on top of them here, and the burst and motif features add nothing either (inside the noise). This is the same pattern as on Elliptic and differs from the 20 to 30% graph gain on IBM's own laundering labels.
- **Weak spots:** batched rings are recovered about a third of the time, delayed rings 44 to 64%, and about 55% of landlord hubs are flagged by the graph models. With only 30 injected rings instead of 90, PR-AUC drops to 0.02. Precision on all candidates is 0.23 to 0.26.
- **Not tested here:** the committed payment-level model. These figures are for the account models.
- The six robustness scenarios were measured before the burst and motif features existed (four feature sets); only the default scenario was re-run.
- Still synthetic and designed by the team that designed the features, so it shows the method works on rings of this kind, not accuracy on real fraud.

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

### A second variant: LI-Small

The same payment-level model (57 features, 5% of non-laundering payments in training, seed 0, same time split and protocol) was trained and evaluated on LI-Small, which has a much lower laundering rate (chance PR-AUC 0.0006 at payment level). It ran on a Kaggle CPU notebook in 789 s, not on the VM, because LI-Small does not fit in the VM's 7.5 GB with our evaluation. Command: `python -m ml.edge_eval LI-Small`. Test window, account level:

| Model | PR-AUC | Precision | Recall | PR-AUC on accounts never flagged before |
|---|---|---|---|---|
| Account model | 0.031 | 0.035 | 0.196 | 0.018 |
| Payment-level model (max per account) | **0.093** | **0.090** | **0.334** | **0.089** |

- **The ranking gain holds on a second variant.** Three times the account PR-AUC (HI-Small: 0.453 against 0.149), and about five times on accounts never flagged before.
- **Absolute accuracy is low.** Precision 9% at 33% recall. Do not describe this as a high-accuracy detector; LI-Small is harder because laundering is rarer.
- **Ring recovery did not improve.** Rings formed without growth, with the share of flagged accounts chosen on validation: the account model recovers 10.2% of the 59 laundering groups (mean purity 3.4%, 3.8% of rings real) and the payment model 6.8% (mean purity 11%, 14% of rings real). The payment model's rings are cleaner but fewer groups are found. We did not run the committed ring-growth setting on LI-Small, so this table says nothing about it.
- The payment model stopped at 75 trees (358 on HI-Small), and its payment-level PR-AUC is 0.076 on test (0.101 on validation). One seed, one split.

### Choices that were tested

- **Burst and motif features** (distinct payers within an hour, six hours or a day; directed triangles; feed-forward loops; repeated amounts) did not help the account model (PR-AUC 0.149 against 0.160). They **did help the payment model** when added to the endpoint features: payment-level PR-AUC 0.468 against 0.434 and account PR-AUC 0.453 against 0.428 (seed 0, same split). The committed model uses them, which makes it 57 features. The 3-seed table above was measured before this change, so the committed model has one seed behind the 0.468 and 0.453 figures, not three.
- **More negative payments in training** (keeping 20% instead of 5%) was slightly worse (payment PR-AUC 0.414 against 0.434), so 5% is used.
- **Ring risk score.** A learned ring score, fitted on validation rings, saturated: validation rings were about 98% real, so there was nothing to learn and most rings showed risk 100. The bundle now skips the learned score whenever fewer than 15% of the training rings are real or not real. Ring risk is then the mean of the ring's three most suspicious accounts' calibrated laundering probabilities, which is well spread (88 to 92 for the top rings) and keeps its meaning. It ranks real rings above others only modestly, so treat it as a priority, not as a probability that the ring is real.

### Caveats specific to this section

- Mostly one dataset (IBM AML HI-Small), one time split, three training seeds; LI-Small above is one seed. Seeds measure training noise, not split noise. The strict 0.25% rows and the growth rows in the rings table are from seed 0 only; the other payment-model and account-model ring figures are ranges over the three seeds.
- The payment model looks at payments in a window together with the history up to the cutoff, including the receiver's next payment. A payment is therefore flagged once the evidence appears (for example when the money is forwarded), which is why detection time is replayed separately.
- Precision and recall are at one validation-chosen threshold; other thresholds trade them off.

## 7. The typology demo bundle: trained with injected pig-butchering rings

The committed IBM-only model (sections 1 to 6) learned IBM's own laundering patterns. Asked about the synthetic pig-butchering rings from `data/rings.py` (section 5), it finds none of them: on 90 rings and 90 look-alikes injected with seed 1 across the 10-day period of HI-Small (the last 48 hours are cut out afterwards, so most rings have fewer than two active fraud accounts in the window), it recovers **0 of 10** rings in the last-24-hour window and **0 of 20** in the 48-hour window, and none of its 10 riskiest rings contains an injected account (`python -m ml.pig_eval HI-Small ml/artifacts/HI-Small 1`). A pig-butchering demo therefore needs a model that has seen the typology.

`ml/artifacts/HI-Small-pig` is the same payment-level pipeline trained on IBM's labels **plus** injected rings (`python -m ml.bundle HI-Small <folder> payment 0`, seed 0), trained on the LinuxONE VM in the platform container in 31 min 46 s including building the feature snapshots for the injected data (account model 691 trees, payment model 800 trees; 800 is the cap, so the payment model had not stopped improving). The demo serves `HI-Pig-Slice`, the last 48 hours of **seed 1**, a different random draw of rings, made with `python -m ml.make_demo_slice HI-Small 48 HI-Pig-Slice 1`. Scored the way the API scores it (`python -m ml.pig_eval HI-Small ml/artifacts/HI-Small-pig <seed>`, run on the VM):

| Rings scored | Active window | Injected rings with 2 or more active fraud accounts | Recovered | Of the 10 riskiest rings, with injected accounts | Look-alike hubs inside a detected ring |
|---|---|---|---|---|---|
| IBM-only model, seed 1 | 24 h | 10 | 0 (0%) | 0 | 0 of 90 |
| IBM-only model, seed 1 | 48 h | 20 | 0 (0%) | 0 | 0 of 90 |
| **Demo bundle, seeds 1 to 4 pooled (other random draws of the training generator)** | 24 h | 43 | **36 (84%)** | 21 of 40 | 6 of 360 |
| **Demo bundle, seeds 1 to 4 pooled (other random draws of the training generator)** | 48 h | 89 | **61 (69%)** | 35 of 40 | 3 of 360 |
| Demo bundle, seed 0 (trained on, but these are later payments than it trained on) | 24 h | 9 | 7 (78%) | 4 | 0 of 90 |
| Demo bundle, seed 0 | 48 h | 19 | 14 (74%) | 9 | 0 of 90 |

The four unseen draws one by one, 24 h / 48 h window: seed 1: 8 of 10 / 11 of 20; seed 2: 5 of 6 / 11 of 16; seed 3: 7 of 9 / 20 of 25; seed 4: 16 of 18 / 19 of 28. Look-alike hubs inside a detected ring, per draw of 90: seed 1: 0 / 0; seed 2: 3 / 2; seed 3: 3 / 1; seed 4: 0 / 0.

Read these with care:

- **The counts are still modest** (6 to 28 rings per draw, 43 and 89 pooled), so a percentage moves by 1 to 3 points per ring when pooled and by 5 to 15 points in a single draw. The spread between draws (55% to 80% in the 48 h window) is the honest measure of how much to trust any one number.
- **By shape, pooled over the four draws in the 48 h window:** fan-in 10 of 10, chain 10 of 11, split 9 of 10, dispersed 9 of 11, delayed 10 of 18, batched 5 of 10, mixed 5 of 10, **aged 3 of 9**. Rings whose accounts already have ordinary history and rings that hold money for hours are the weak spots, which matches what the model keys on (next bullet).
- **Same generator for training and testing.** The injected rings in training and in the demo come from the same code, written by the team that wrote the features. This shows the model can learn this typology, not that it detects real pig-butchering. The IBM-only rows are the honest measure of what a model that has not seen the typology does: nothing.
- **What the model keys on.** After the explanation fix below, the top reasons for fully injected rings are mostly *absences*: no transfers to itself, no payments flowing back and forth, no long activity history, no repeated amounts. The one positive cue is money leaving within minutes. The model is largely recognising brand-new accounts with simple one-way flows. The generator's "aged" rings and "new-customer" look-alikes exist to break that shortcut, and aged rings are the shape it misses most.
- **Look-alike hubs** (merchants, payroll, landlords, charities, new customers) rarely end up inside a detected ring: 6 of 360 in the 24 h window and 3 of 360 in the 48 h window across the four draws, all in two of the draws. That is a count of hubs touching a detected ring, not a measured false-alarm rate on real customers.
- This bundle is for the demo and the typology evidence. **The headline benchmark numbers in sections 1 to 6 are for the IBM-only bundle**, which is unchanged.

### A variant trained with more aged rings (tried, not adopted)

Aged rings (accounts with earlier ordinary history) are the shape the demo bundle misses most, so we trained a second bundle on the same data with 60% of the rings aged instead of 25% (`python -m ml.bundle HI-Small <folder> payment 0 aged_share=0.6`, 22 minutes on the VM; the payment model stopped early at 581 trees where the first one reached the 800-tree cap) and scored it on the same four unseen draws with the default ring mix (`python -m ml.pig_eval HI-Small <folder> <seed>`, seeds 1 to 4, pooled):

| Measure | Demo bundle (25% aged in training) | Variant (60% aged in training) |
|---|---|---|
| Rings recovered, last 24 h | 36 of 43 (84%) | 35 of 43 (81%) |
| Rings recovered, last 48 h | 61 of 89 (69%) | 61 of 89 (69%) |
| Aged rings recovered, 48 h | 3 of 9 | 3 of 9 |
| Of the 10 riskiest rings, with injected accounts: 24 h / 48 h | 21 of 40 / 35 of 40 | 13 of 40 / 14 of 40 |
| Look-alike hubs inside a detected ring: 24 h / 48 h | 6 of 360 / 3 of 360 | 2 of 360 / 0 of 360 |

**The aged-ring weakness is not a training-mix problem**: recovery is the same and the aged rings are still 3 of 9. The variant also puts injected rings lower in the risk ranking (14 of 40 against 35 of 40 among the riskiest in 48 h), which matters for a demo whose first screen is the riskiest rings, and it raises fewer false alarms on look-alike hubs. We kept the first bundle. One training seed each; the counts are small.

### Explanations now say when a signal is absent

SHAP says which features pushed a score up, not whether the feature was high or low. The first labels ("Many transfers to itself") assumed high, so an injected ring, which has no self-transfers at all, was explained with "Receiver: many transfers to itself": the opposite of the data. Each reason now checks the feature's value against the typical value in the scored window, and when the label is not true it adds "(absent)" (`ml/explain.py: label_holds`; `ml/tests/test_explain.py`). A ring's reasons use the members' mean values, and a one-hot or a share counts as true only at 0.5 or more. The ring headline leads with the first signal that is really present. Reasons that have no direction (time of day, payment size) are never marked.

## 8. The on-chip AI accelerator: what we measured, and what we did not ship

The LinuxONE VM has the NNPA facility (the CPU reports `nnpa`) and the platform container has TensorFlow with the `ibm-zdnn-plugin`, `torch_nnpa` and `llama.cpp` built with zDNN, plus an IBM Granite 4.0 350M base model. The platform's own notebooks "verify" acceleration by checking that a library file exists and printing a fixed list of "accelerated ops", which proves nothing about where arithmetic ran. The VM exposes the processor's own counters (`pai_ext`, events such as `NNPA_MATMUL_OP`), so we count NNPA operations from outside the container while each workload runs (`bash infra/accel_counters.sh`, workloads in `ml/accel_probe.py`, idle VM, 2026-10-18):

| Workload | Speed | NNPA operations | of which matrix multiplies | sigmoid |
|---|---|---|---|---|
| XGBoost trees, 200 trees, 200,000 rows (control) | 534,793 rows/s | **0** | 0 | 0 |
| TensorFlow dense network (120, 256, 128, 1), 200,000 random rows | 1,305,552 rows/s | 5,459 | 471 | 157 |
| *Re-run 2026-10-18, first (not kept as a file)* | 1,207,138 rows/s | 6,504 | 471 | 157 |
| *Archived re-run 2026-10-18 13:52 UTC (`docs/evidence/accelerator_counters.txt`, image 10)* | 1,572,223 rows/s | 4,219 | 471 | 157 |
| IBM Granite 4.0 350M through llama.cpp, 40 tokens | 7.4 tokens/s | 36,106 | 6,160 | 0 |
| *Re-run 2026-10-18, first (not kept as a file)* | 9.6 tokens/s | 36,368 | 6,160 | 0 |
| *Archived re-run 2026-10-18 13:52 UTC (image 10)* | 9.4 tokens/s | 36,112 | 6,160 | 0 |

So the claim that is true and measured: **some operations of a network and of Granite 4.0 350M (through llama.cpp, which leaves 235 tensors on the CPU) run on the accelerator on this VM; trees do not.** The raw output of the last run is archived (`docs/evidence/accelerator_counters.txt`, image 10). The total count varies between runs (network 4,219 to 6,504, Granite 36,112 to 36,368); the matrix-multiply and sigmoid counts were identical. The counters are machine-wide while nothing else ran, and in an earlier probe the relu counter stayed at 0, so not every operation of the network is offloaded. Counts are operations, not a speed-up: we did not compare against the same network with the accelerator off.

**NEXUS Z's detection does not use the accelerator**, because the network we tried was worse than the trees:

### A neural network on the same payments (not shipped)

`python -m ml.neural HI-Small <folder> 0 <share of normal payments kept>`: a dense network (256, 128, 64) on the same payment features as the payment trees, trained on the demo data (IBM plus injected rings, seed 0), with the share of each model chosen on validation. Test window, 1,021,539 payments:

| Model | Payment PR-AUC | Account PR-AUC |
|---|---|---|
| Payment trees (XGBoost) | **0.818** | **0.541** |
| Network trained on 5% of normal payments (162,347 rows) | 0.508 | 0.128 |
| Network trained on 15% of normal payments (about 460,000 rows) | 0.732 | 0.391 |

On validation, mixing in any share of the network lowered PR-AUC (trees alone 0.9668; with a quarter network 0.9639 to 0.9660; network alone 0.907 to 0.939), so the best mix is trees only. A run with 40% of normal payments was killed for lack of memory (7.5 GB). One seed, one data set; more careful tuning might close more of the gap, but trees on tabular data like this are hard to beat and the demo needs a working system.

### Granite case summaries (not shipped)

First attempt: Granite wrote a whole summary from a fact sheet. It attached numbers to the wrong facts ("Two likely victims" for a ring with one; "9 more payers may be at risk" for a ring with none, where 9 was the collector count), and a check that asks only whether a number appears on the sheet passed both. Second attempt: the model wrote one sentence with no numbers or ids, from three worked examples; 10 of 10 sentences passed that check, but three were copies of an example, and of the other seven at least three were wrong or nonsensical, for example "paid by ach" became "A payment made by a credit card is a payment made by a credit card", and "the receiver passes the money on quickly" became "The receiver of a payment is often the same person who sent it." (judged by reading them, not by a formal rating). A check can reject numbers and accusations but not a wrong meaning, so **nothing a model writes reaches a user**. The case summary on each ring (`summary` in `GET /rings/{id}`, `ml/narrative.py`) is a template of exact facts plus hand-written, cautious meanings of the main signal.

What this section does and does not support: the accelerator works on this platform and we can prove it with hardware counters; a model that uses it is not better than ours for this task, so ours does not.

## 9. A real-data check of the ring idea: Elliptic++ Bitcoin wallets

Everything so far on pig-butchering is synthetic, so we ran the ring idea once on real labeled data: **Elliptic++** (Elmougy and Liu, KDD 2023, [doi 10.1145/3580305.3599803](https://doi.org/10.1145/3580305.3599803)), 822,942 Bitcoin wallet addresses with 55 features per address and time step, a label per address (14,266 illicit, 251,088 licit, 557,588 unknown) and a directed address-to-address payment graph of 2,822,983 edges. **This is not pig-butchering**: "illicit" is Elliptic's generic label. The dataset states no licence and asks for citation; we used it for evaluation only, did not copy it into the repository, and cite it. Command: `python -m ml.elliptic_actors_eval` (about 90 seconds; data from `NEXUSZ_DATA_DIR/elliptic++`; raw output in `docs/evidence/elliptic_actors_eval.txt`).

**Design, so that nothing from the future reaches the past.** The edge list has no timestamps, so each address is one row (its last row) and the split is by when addresses appear: train = addresses whose last time step is at most 28 (443,023), validation = 29 to 34 (77,346), test = addresses that first appear at step 35 or later (292,102 new addresses; their whole life is in the test period). Graph features and rings use only edges between addresses of the same window. Only labeled addresses are scored (92,451 in the test window, 5.3% illicit); unlabeled addresses stay in the graph, as they would in use. Five training seeds with the split fixed; means and standard deviations below.

**1. Illicit wallets cluster in the payment graph.** Given an illicit wallet, 90.2% of its labeled neighbours in the test graph are illicit, against 5.4% of labeled wallets overall: a lift of 16.8 (5,140 illicit-to-illicit edges among 370,561 labeled edges). Elliptic's labels may be assigned per entity, in which case wallets of one entity are linked by construction and this overstates how much unrelated illicit actors cluster; we did not check how the labels were made.

**2. Our graph features help on this graph** (degree, PageRank, k-core, clustering, component size, computed with the same code as the main model):

| Wallet-level, test window, new addresses | PR-AUC (chance 0.053) | ROC-AUC | Precision in the top 1,000 |
|---|---|---|---|
| Dataset's own 55 features | 0.348 ± 0.016 | 0.849 ± 0.004 | 0.656 ± 0.100 |
| + our graph features | **0.431 ± 0.025** | 0.880 ± 0.007 | 0.844 ± 0.039 |

The gain (+0.083 PR-AUC) is larger than the spread between seeds. It is the opposite of what we found on Elliptic's transaction graph (`docs/ML_RESULTS.md` section 1, where graph features added nothing); the two graphs, splits and labels differ, so the two results do not contradict each other, but neither generalizes to the other.

**3. Rings of flagged wallets are pure, but they cover very little.** Flagged = the top share of test wallets by score; rings = the payments between flagged wallets, split into connected groups and Louvain communities (`ml.rings.detect_rings`, unchanged). Means over five seeds:

| Scores from | Flagged | Rings (with 2+ labeled) | Mean ring purity | Illicit wallets inside rings | Precision of flagged wallets in rings / not in rings |
|---|---|---|---|---|---|
| Dataset features | 1% | 0.2 (0) | no rings | 0 | none in rings / 0.690 |
| + our graph features | 1% | 7.8 (5.8) | **0.848** ± 0.094 | 33 | **0.915** / 0.834 |
| + our graph features | 2% | 40.8 (17.2) | **0.868** ± 0.029 | 90 | **0.904** / 0.710 |
| Random score, same code (baseline) | 1% | 20.0 (13.2) | 0.003 | 0 | 0.010 / 0.055 |

Purity is the share of illicit wallets among a ring's labeled members. Wallets that sit in a ring with other flagged wallets are more often illicit than flagged wallets that do not (0.915 against 0.834 at 1%; 0.904 against 0.710 at 2%), and rings built from a random score are worthless (purity 0.003), so the measurement works. **But coverage is tiny:** the rings hold about 33 to 90 of roughly 4,900 illicit test wallets (under 2%), and 96% of the wallets flagged at 1% (94% at 2%) belong to no ring at all, because flagged Bitcoin addresses rarely pay each other directly. The scores from the dataset's own features form almost no rings. And the graph-feature model flags well-connected wallets to begin with, so part of the difference between "in a ring" and "alone" is the model's own preference for connected wallets, not extra evidence from grouping.

**What this supports and what it does not.** It supports a narrow claim: on real illicit Bitcoin actors, illicit wallets do cluster, our graph features improve the ranking, and the few rings we can form are mostly illicit. It does not support any claim about pig-butchering, about detection rates (rings reach under 2% of illicit wallets), or about transaction data from banks. One dataset, one split, no edge timestamps.

## Caveats that apply to everything above

- Single time split per dataset. Seeds measure training noise, not split noise.
- The IBM groups are generic laundering patterns, not pig-butchering. Section 5 covers pig-butchering only on stand-in data.
- HI-Small is a 10-day synthetic window. Test windows hold 1,000 to 2,000 positive accounts.
- Ring `total_amount` adds up amounts in several currencies and must not be shown as dollars.
- Roles (victim, collector, mule, cash-out) are guessed from position inside a ring. IBM data has no role labels, so they are not validated.
- Account age is not used, because IBM has no account open date.
