# Claims audit

Data and evaluation workstream, 2026-10-18, on `main` at `4329aab`. Nothing in the other documents was edited: every row gives the exact sentence and a corrected wording.

**Verdicts.** OK: the source exists and the wording fits it. OVERSTATED: the wording is stronger than the source (or the source has a qualifier the sentence drops). SOURCE NOT FOUND: no file, command or image in the repository records the number, or a cited item is missing. "Output archived" says whether the raw output of the cited run is in the repository; for most ML and VM numbers it is not (only the command is), so I could check them against each other and against the code, but not against a log. Where I could re-run something, the row says so.

## The ten things most worth fixing before submission

1. **"84% / 69% of rings recovered"** (README lines 6 and 41, `ML_RESULTS.md` section 7, video script 2:15) drops three qualifiers: it is a share of the rings with at least two *active* fraud accounts in the window (43 of 360 injected rings at 24 h, 89 of 360 at 48 h); "recovered" means half of the *active* accounts, not half of the ring; and it depends on how much history the scorer is given. My re-run on four new draws gives 76% and 57%; pooled over all eight draws 80% and 63%. Scored with the full history the model was trained with, the same rings give 95% and 89% (75% at 48 h under my stricter definition), so the headline depends on a serving choice nobody states. Details: `eval/results/DEMO_BUNDLE.md`.
2. **"Warns the next victim before they pay"** (README lines 18 and 27, form text "likely next victims", video 0:00 "points to the next person who may pay in"): the code (`ml/service.py: likely_victims`) lists accounts that *already paid* into a flagged ring in the last 48 hours. It predicts nothing about the next payment, and `PLATFORM_RESULTS.md` section 4 says the rule "has not been evaluated". The dashboard says **"victim warnings sent"** in five places (`Dashboard.jsx:98,155`, `RingDetail.jsx:102`, `Alerts.jsx:72,75`) while `DEMO.md` says "do not say that warnings were sent".
3. **The accelerator counts have no recorded output.** The numbers 0, 5,459 and 36,106 appear in `ML_RESULTS.md`, `TECHNICAL_DESIGN.md`, `README.md` and the video script, but the capture image `10_accelerator_counters.png` was never made (`docs/evidence/README.md`: "Not captured yet"), and no log of `infra/accel_counters.sh` is in the repository. The Granite measured is a 350M base model, not the Granite 4.2 the Assistant uses.
4. **"Accuracy 0.45 against 0.15"** (form text, video script) is one seed and a different pair from the README's 0.428 against 0.153 (three seeds). Use one.
5. **The AI-assisted chat has never produced a Granite answer.** `CHATBOT.md`: the one authenticated call returned HTTP 402 (no credits). The README paragraph reads as a working feature.
6. **API row in the README:** "no server errors" is true of 5xx responses, but 4,453 of 9,299 ring-detail requests in the benchmark returned 404 because ring ids changed on every rebuild (`PLATFORM_RESULTS.md` 3c and 3d), and the oldest served state under load was 36 s. The video script says the ring list changes "in about ten to twelve seconds" while the replay (a sustained stream) is running, which is the case where the measured worst figure is 36 s.
7. **Freshness is quoted three ways.** README "about 10 s", form text "about 12 s" (from the superseded bare-process run), `DEMO.md` "about 12 seconds" and "near real time". `ML_RESULTS.md` line 138 says "a few seconds".
8. **`TECHNICAL_DESIGN.md` line 77** says the committed payment model "has not been tested on those rings"; `ML_RESULTS.md` section 7 tests it (0 of 10 and 0 of 20). Line 77 also says the account models "recover 70 to 74% of rings"; that holds only for the graph-feature sets (transaction-only 62%, behavioral 64%).
9. **`ML_RESULTS.md` section 7 describes my generator wrongly**: "90 rings and 90 look-alikes injected ... into the last 48 hours". They are injected over the whole 10-day period and the last 48 hours are cut out afterwards; that is why most rings do not count in the window.
10. **Open-source list:** the Uvicorn link (`www.uvicorn.org`) does not resolve; React, React Router, D3, Vite, Vitest, httpx, psutil, TensorFlow, llama.cpp and the IBM Granite models are used but not listed; no software licence is listed at all. See the last heading.

## A. Claims a judge could quote

| # | Claim (exact words) | Where | Source | Found | Output archived | Verdict | Corrected wording |
|---|---|---|---|---|---|---|---|
| 1 | "the demo bundle, trained with them, recovers 84% (24 h window) and 69% (48 h) of rings drawn after training" | README l.6; l.41 (table); `ML_RESULTS.md` s.7; video 2:15 ("recovers 84 percent in the last day") | `python -m ml.pig_eval HI-Small ml/artifacts/HI-Small-pig <seed>`, seeds 1 to 4 | command yes | no (seeds 1 to 4); mine for 5 to 8 yes | OVERSTATED | "On synthetic rings from the generator the bundle was trained with (different random draws), the demo bundle recovered 64 of 80 (80%) of the rings that had at least two active fraud accounts in the last 24 hours and 109 of 173 (63%) in the last 48 hours (eight draws; individual draws 62 to 89% and 50 to 80%). Those are 10 to 25% of the injected rings; the others had fewer than two active accounts in the window." |
| 2 | "the IBM-only model: 0%" (next to "4 random draws pooled") | README l.41 | `ML_RESULTS.md` s.7: 0 of 10, 0 of 20 on seed 1 only | yes | no | OVERSTATED | The IBM-only model was scored on one draw (0 of 10 at 24 h, 0 of 20 at 48 h), not on the four pooled. |
| 3 | "rings drawn after training" | README l.6 | `ML_RESULTS.md` s.7 | yes | no | OVERSTATED | "rings from a different random draw of the same generator, on the same IBM background". Not "after" in time. |
| 4 | "Account-level PR-AUC ... account model 0.153; payment-level model 0.428 (precision about 0.74, recall about 0.31)" | README l.35 | `ML_RESULTS.md` s.6 table (3 training seeds); `python -m ml.edge_eval HI-Small` | yes | no | OK | Add: "detection of laundering in the window (the features can see the window's own payments, `ml/PROTOCOL.md`), measured before the burst and motif features; the committed 57-feature model is 0.453 on one seed". |
| 5 | "Graph features vs transaction-only, account model only | 0.110 to 0.135 (up to 0.160 ...)" | README l.36 | `ML_RESULTS.md` s.1 (Kaggle) and s.4 (VM, identical) | yes | no | OK | Add: "and nothing on top of timing features on the synthetic rings (`eval/results/RESULTS.md`)". |
| 6 | "34%, with 70% of rings real (account model: 20 to 30% recovered, 31 to 46% real)" | README l.38 | `ML_RESULTS.md` s.6 rings table; l.252 says the growth rows are seed 0 only | yes | no | OVERSTATED | One seed for the 34% and 70%, set against a range over three seeds for the account model. Say "34% (one seed)". |
| 7 | "55% (36 of 65) with the committed model, against 20% for its account model; median 9.7 hours; 45% not detected" | README l.39 | `ML_RESULTS.md` s.3; `python -m ml.detection_time HI-Small <folder> 6` | yes | no (evidence 08 is the training log only) | OK | none |
| 8 | "first state 12 s; a new payment visible in about 10 s; idle requests about 1 ms; no server errors" | README l.42 | `PLATFORM_RESULTS.md` 3c: 12.1 s, 9.63 to 9.91 s, medians 0.76 to 1.68 ms | yes | evidence 07 shows 3b only | OVERSTATED | "first state 12 s; a new payment visible in about 10 s on the idle VM (9.6 to 9.9 s, three probes) and up to 36 s while payments stream in; reads about 1 to 2 ms (median, loopback); no 5xx responses (one run)". Say elsewhere that 4,453 of 9,299 ring-detail requests were 404 because ring ids changed on rebuild; stable ids were added after, measured once locally. |
| 9 | "Full rescore on the LinuxONE VM (3 vCPUs) | 0.28 s for 6 hours of data, 3.2 s for 48 hours (863K transactions), 15.7 s for all 5.1M transactions" | README l.44; `TECHNICAL_DESIGN.md` l.42 | `python -m ml.scaling_check HI-Small <folder>`; `ML_RESULTS.md` s.4 | yes | no | OK | none |
| 10 | "Ring idea on real illicit Bitcoin wallets ... 90% of labeled neighbours illicit, 16.8x chance ... 0.348 to 0.431 ... 85% pure but reach under 2% of illicit wallets. Not pig-butchering" | README l.43; `ML_RESULTS.md` s.9 | `docs/evidence/elliptic_actors_eval.txt` | yes | **yes** | OK | I checked every number against the raw output: 0.902 and 16.8x, 0.348 and 0.431, purity 0.848 and 0.868, 33 and 90 illicit wallets in rings, 96% and 94% of flagged wallets in no ring. |
| 11 | "a model trained on a little-endian laptop gives identical predictions on the s390x VM (largest difference 9e-16)" | README l.57; `TECHNICAL_DESIGN.md` l.45 | `PLATFORM_RESULTS.md` s.3: 8.88e-16 over 300 rows; `python -m ml.latency_check` | yes | no | OVERSTATED | The check was done with the earlier account-level model (before the payment model). The committed models were trained on the VM. Say "an earlier account-level model trained on a laptop". |
| 12 | "Training the final payment-level model takes about 15 minutes" | README l.55 | evidence 08: "exit 0 after 882 s"; 374 and 358 trees | yes | **yes** (image) | OK | I confirmed 374 and 358 trees from `ml/artifacts/HI-Small/*.json` (`best_iteration` 373 and 357), and 691 and 800 for the demo bundle. Say that this is the IBM-only bundle; the demo bundle took 31 min 46 s. |
| 13 | "Security: Jupyter is bound to the VM's loopback ... the platform README's public port and published default token are deliberately not used" | README l.56 | evidence 02, 03 | yes | **yes** | OK | none |
| 14 | "Containerized serving: ... loopback only, non-root, read-only filesystem, every capability dropped, memory limit" | README l.58 | evidence 09; `PLATFORM_RESULTS.md` 3c | yes | **yes** | OK | none |
| 15 | "the VM's NNPA counters show a neural network and IBM Granite executing thousands of accelerator operations and XGBoost none" | README l.59; `TECHNICAL_DESIGN.md` l.44, l.52; video 2:15 | `bash infra/accel_counters.sh` (5,459 and 36,106 and 0, `ML_RESULTS.md` s.8) | script yes, `ml/accel_probe.py` yes | **no**; image 10 "not captured yet" | SOURCE NOT FOUND | Capture it (VM idle) and commit the raw output. Until then: "we measured ... (output to be added)". Name the model: "IBM Granite 4.0 350M base through llama.cpp" (`LAB_EVIDENCE.md` l.37), not the Granite 4.2 of the Assistant. |
| 16 | "networks and Granite run on the accelerator on this VM; trees do not" | `ML_RESULTS.md` l.310 | same | yes | no | OVERSTATED | `LAB_EVIDENCE.md` l.27: llama.cpp puts 501 MiB of weights in a zDNN buffer, 235 tensors fall back to CPU and "the layers are assigned to the CPU device". `ML_RESULTS.md` itself says "not every operation of the network is offloaded". Write "execute some operations on the accelerator". |
| 17 | "Marks accounts that recently paid into a flagged ring as likely victims and raises a warning." | README l.27 | `ml/service.py: likely_victims` (outside accounts that paid a ring member in the last 48 h) | yes | n/a | OK | Matches the code. |
| 18 | "A system that flags the ring early, explains why, and warns the next victim before they pay protects them." | README l.18 | none; the rule only lists accounts that already paid | no | n/a | OVERSTATED | "...flags the ring, explains why, and shows who has recently paid into it, so that they can be contacted." The warning rule is unevaluated (`PLATFORM_RESULTS.md` s.4: a warned account had risk 0.0021 and no ring). |
| 19 | "The language model is IBM Granite 4.2 ... It answers only from our own API through read-only tools, every answer is checked for invented ids" | README l.50 | `CHATBOT.md`: 37 unit tests against a fake provider; the one real call returned HTTP 402 | yes | no | OVERSTATED | Add "No Granite answer has been produced yet: the only authenticated call returned HTTP 402 (no credits), so the page currently answers by rules. The model's provider retires the 30B endpoint on 2026-10-18." |
| 20 | "Pig-butchering scams groom victims over weeks ... Funds move through chains of mule accounts within minutes" | README l.10 to 16 | none cited | no | n/a | SOURCE NOT FOUND | No source for the typology or its timing. Our own generator makes rings that hold money for hours or days, and the model misses them most. Cite one source or write "typically". |
| 21 | "Banks see single payments, not the ring behind them, so the money is usually gone before a victim reports it." | `SUBMISSION_TEXT.md` problem field | none cited | no | n/a | SOURCE NOT FOUND | Add a source or soften: "...so the ring is hard to see". |
| 22 | "An XGBoost payment-level model uses ... and 57 graph and timing features of both accounts" | `SUBMISSION_TEXT.md` solve field | `ml/features.py`: 26 transaction + 8 timing + 10 graph + 4 structure + 9 burst and motif = 57 (I counted) | yes | n/a | OVERSTATED | "57 account features (transaction, timing, graph, structure, burst and motif) of both accounts". 26 of the 57 are transaction aggregates. |
| 23 | "FastAPI and a React dashboard show each ring, its roles, the reasons and likely next victims" | `SUBMISSION_TEXT.md` | `ml/service.py` | yes | n/a | OVERSTATED | "...and the accounts that recently paid into it". |
| 24 | "On IBM AML HI-Small (time split, no look-ahead) account PR-AUC is 0.45 against 0.15 for an account-level model" | `SUBMISSION_TEXT.md` | `ML_RESULTS.md` s.6 l.239 and l.246: 0.453 against 0.149, seed 0 (3-seed figures are 0.428 and 0.153) | yes | no | OVERSTATED | "...one seed: 0.45 against 0.15; three seeds before the burst and motif features: 0.43 against 0.15. This is detection of laundering inside the scored window." The sources table points to "choices tested", where 0.149 is the motif *account* model; the pair appears in the LI-Small bullet. |
| 25 | "Trained on the VM in 882 s; a new payment shows in about 12 s." | `SUBMISSION_TEXT.md` | 882 s: evidence 08 (IBM-only bundle); 12 s: `PLATFORM_RESULTS.md` 3b (bare process, superseded) | yes | partly | OVERSTATED | The demo bundle that is shown took 31 min 46 s. The deployed container measured 9.6 to 9.9 s. Use "about 10 s idle (up to 36 s under load)". |
| 26 | "(445 characters)" and "(805 characters)", limit 1,024 | `SUBMISSION_TEXT.md` | counted | yes | n/a | OK | Both counts are exact. |
| 27 | "points to the next person who may pay in" / "a new payment reaches the ring list in about ten to twelve seconds on the idle machine" | video 0:00 and 1:40 | `likely_victims`; `PLATFORM_RESULTS.md` 3c | yes | n/a | OVERSTATED | The replay at `--speed 600` is sustained ingest, not an idle machine: the measured worst figure is 36 s. Say "about ten seconds when the machine is idle, up to half a minute while payments stream in". |
| 28 | "357 spoken words ... 328 without" | video, word count | counted | yes | n/a | OVERSTATED | I count 367 and 328. Row 2:15 to 2:50 has 82 spoken words, not 72; the accelerator sentences are 39 words, not 29. |
| 29 | "evidence 10 (accelerator counters)" | video 2:15 and 2:50 notes; `DEMO.md` step 7 | `docs/evidence/10_accelerator_counters.png` | **no** | n/a | SOURCE NOT FOUND | Capture it or cut the slide (the script already says so). |
| 30 | "All four platform notebooks run end to end" | `TECHNICAL_DESIGN.md` l.47; `LAB_EVIDENCE.md` | executed copies are "on the VM ... not committed" | doc only | no | SOURCE NOT FOUND | `LAB_EVIDENCE.md` l.41 says the screenshots are still needed. |
| 31 | "The test suite passes inside the platform container" (`python -m pytest ml/tests api/tests -q`) | `TECHNICAL_DESIGN.md` l.48 | evidence 04 | yes | yes | OVERSTATED | Evidence 04 shows the documented command failing at collection on the VM (`test_stack.py` needs scikit-learn); inside the container only `ml/tests` ran (77 passed, 1 skipped). PR #40 made `ml/stack.py` import scikit-learn lazily; I confirmed that `ml.stack`, `ml.service` and `ml.api_backend` now import with scikit-learn blocked, but I could not run the VM test command. Image 04 predates the fix: re-capture it. |
| 32 | "On the more varied generator (`data/rings.py`, 3 seeds) the account models reach PR-AUC about 0.4 and recover 70 to 74% of rings" | `TECHNICAL_DESIGN.md` l.77 | `eval/results/RESULTS.md` | yes | **yes** | OVERSTATED | PR-AUC 0.18 (transaction-only), 0.41, 0.36, 0.41, 0.40; recovery 62%, 64%, 74%, 73%, 70% with spreads of 0.06 to 0.17. "The timing- and graph-feature account models reach about 0.4 and recover 64 to 74%". |
| 33 | "The committed payment-level model has not been tested on those rings." | `TECHNICAL_DESIGN.md` l.77 | `ML_RESULTS.md` s.7 | yes | no | OVERSTATED | It was: 0 of 10 and 0 of 20 (seed 1), and the demo bundle (payment-level) was scored on eight draws. |
| 34 | "Pig-butchering rings are only tested in section 5, on stand-in rings written by the modelling side, because the data workstream's generator was not available." | `ML_RESULTS.md` l.5 | sections 5 (second half) and 7 | yes | n/a | OVERSTATED | "Pig-butchering rings are tested in sections 5 and 7, on stand-in rings and on the generator `data/rings.py`, both written by our own team." |
| 35 | "48 account features" | `ML_RESULTS.md` l.12 | `ml/features.py`: 57 | yes | n/a | OVERSTATED | "57 account features". |
| 36 | "New transactions appear after the next rescore (a few seconds), not instantly." | `ML_RESULTS.md` l.138 | `PLATFORM_RESULTS.md`: 9.6 to 12.6 s idle, 36 s loaded | yes | n/a | OVERSTATED | "about ten seconds when idle, up to half a minute when payments stream in". |
| 37 | "A rolling protocol rebuilds features from only the last 48 hours ... it is not what the saved model uses." | `ML_RESULTS.md` l.162 | `ml.pig_eval` and the API (`NEXUSZ_HISTORY_HOURS=24`) build features from 24 or 48 hours of history | yes | n/a | OVERSTATED | The demo and the evaluation of the demo bundle do use bounded history, and the recovery figures depend on it (`eval/results/DEMO_BUNDLE.md`). Say so in section 7. |
| 38 | "90 rings and 90 look-alikes injected with seed 1 into the last 48 hours of HI-Small" | `ML_RESULTS.md` l.258 | `data/rings.py: inject` | yes | n/a | OVERSTATED | "90 rings and 90 look-alikes injected across the 10-day period; the last 48 hours were then cut out, so most rings have fewer than two active accounts in the window". |
| 39 | "aged rings are the shape it misses most" | `ML_RESULTS.md` l.278 | s.7 by-shape counts (aged 3 of 9) | yes | no | OVERSTATED | On my four new draws delayed rings are missed more (3 of 17 in 48 h, against aged 7 of 17); over all eight draws aged 10 of 26 and delayed 13 of 35 are indistinguishable. "aged and delayed rings are the weak spots". |
| 40 | "Look-alike hubs ... rarely end up inside a detected ring: 6 of 360 ... and 3 of 360" | `ML_RESULTS.md` l.279 | s.7 | yes | no | OK | My draws: 10 and 6 of 360, **all merchants**. Say which type: about 11% of merchant hubs at 24 h. Landlords are barely exercised in the default mix (3 active in 24 h over four draws, 12 in 48 h); in a landlord-only run 8% to 19% of the 53 active landlords scored above the threshold and 7 sat inside a detected ring with full history (`DEMO_BUNDLE.md`). |
| 41 | "half of them adversarial (fast pass-through)" | `ML_RESULTS.md` l.185 | `data/rings.py`: `adversarial=0.5` is a probability per look-alike | yes | n/a | OK | "each look-alike is adversarial with probability 0.5 (47 of the 90 active ones in my draws)". |
| 42 | "Full rescore of the last 48 hours ... 2.3 s, 5.4 ms per account" and, a few lines above, "2.4 to 2.5 s ... 8.4 to 8.6 ms" for the same model on the same VM | `ML_RESULTS.md` l.132 to 133 and l.153 | two tables | yes | no | OVERSTATED | Two different per-account latencies (8.4 to 8.6 ms and 5.4 ms) for one model; name the run each belongs to or keep one. |
| 43 | "Being deployed on the VM by the platform and dashboard workstreams (not part of the measurements below)" | `TECHNICAL_DESIGN.md` l.14 | row 43 of the same table reports the API and dashboard measured on the VM | yes | n/a | OVERSTATED | Contradicts the table below it; update. |
| 44 | "The API currently serves sample data by default. `ml/api_backend.py` provides the real-model backend and is being wired in" | README l.89 | `api/README.md`; `infra/podman_api.sh` | yes | n/a | OVERSTATED (stale) | "The API serves invented sample data unless `NEXUSZ_BACKEND=model`; the VM deployment runs the model backend." |
| 45 | "`data/` | Dataset loaders (IBM AML) and profiling" and no row for `eval/`, `infra/`, `dashboard/` | README l.120 to 123 | repository layout | yes | n/a | OVERSTATED (stale) | `data/` also holds the ring generator, the exporter and the Elliptic loader; add `eval/`, `infra/`, `dashboard/`. |
| 46 | "Results are from stand-in rings used for testing." / "Tested on stand-in rings." | `Dashboard.jsx:54`, `Layout.jsx:40` | the demo uses rings from `data/rings.py`, not `ml/standin_rings.py` | yes | n/a | OVERSTATED (stale) | "Synthetic rings made by our own team (`data/rings.py`)." |
| 47 | "victim warnings sent" / "No victim warnings sent yet." / "{n} sent" | `Dashboard.jsx:98,155`, `RingDetail.jsx:102`, `Alerts.jsx:72,75` | nothing is sent anywhere; `DEMO.md`: "do not say that warnings were sent" | yes | n/a | OVERSTATED | "likely-victim flags" / "No likely-victim flags yet." |
| 48 | "Team architecture reference: https://claude.ai/artifact/..." | README l.77 | the page returns 200 (every claude.ai page does) | unverifiable | n/a | SOURCE NOT FOUND | I cannot tell whether judges can open it; the README already has the Mermaid diagram. Remove the link or confirm it is public. |
| 49 | "The committed payment-level model (57 features; an account model of 374 trees and a payment model of 358 trees)" and "57-feature payment model" | `ML_RESULTS.md` l.146 and l.242; `docs/evidence/README.md` item 08 (the training log) | `ml/artifacts/HI-Small*/model_payment.json` `feature_names` | yes | partly (image 08) | OVERSTATED | I read the model files: the payment model takes **130 inputs** (16 about the payment and its flow, plus the 57 account features of each of the two endpoints); 57 is the account model's input count. "A payment model of 358 trees on 130 inputs (57 account features per endpoint)". The tree counts are right (374 and 358; 691 and 800). |

## B. Numbers that should be identical everywhere

| Number | Where it appears | Consistent? | Use |
|---|---|---|---|
| **0.45 and 0.15** | form text and video: "0.45 against 0.15". README and `ML_RESULTS.md` s.6: **0.428** against **0.153** (3 seeds). `TECHNICAL_DESIGN.md`: both, labelled. `ML_RESULTS.md` l.239: 0.453 against **0.149**; l.246 the same 0.149 is the *motif account model* | No. Three different account-model baselines (0.149, 0.153, 0.160) and two payment figures | "0.43 against 0.15 (three seeds); 0.45 on one seed with the burst and motif features" |
| **84% and 69%** | README (twice), `ML_RESULTS.md` s.7, video (84% only) | Same value everywhere; wrong qualifiers | see claim 1 and `DEMO_BUNDLE.md` |
| **12 s and 10 s** | README: first state 12 s, new payment about 10 s. Form: new payment about 12 s. `DEMO.md`: "about 12 seconds" twice. Video: "ten to twelve". `TECHNICAL_DESIGN.md`: 12.1 s first state, 9.6 to 9.9 s new payment. `PLATFORM_RESULTS.md`: 12.27 to 12.61 s (3b, superseded) and 9.63 to 9.91 s (3c, final). `ML_RESULTS.md`: "a few seconds" | No. "12 s" means the first state in one place and a new payment in others | "about 10 s idle (9.6 to 9.9 s), up to 36 s under load; first state 12 s" |
| **882 s** | README ("about 15 minutes"), `ML_RESULTS.md` l.146, `TECHNICAL_DESIGN.md` l.41, form, video, evidence 08 | Yes. All refer to the IBM-only bundle | add "the demo bundle took 31 min 46 s" |
| **34%** | README, `ML_RESULTS.md` l.225, `TECHNICAL_DESIGN.md` l.76 ("a third"), form ("a third") | Yes, but never "one seed" | "34% (one seed)" |
| **55% (36 of 65), 20% (13 of 65), 9.7 h, 45%** | README, `ML_RESULTS.md` s.3, `TECHNICAL_DESIGN.md` | Yes | |
| **3.2 s, 0.28 s, 15.7 s, 863K** | README, `ML_RESULTS.md` s.4, `TECHNICAL_DESIGN.md` | Yes | |
| **57 features** | `TECHNICAL_DESIGN.md` (account features), `ML_RESULTS.md` s.6 and l.146 ("57 features" for the payment model), form (57 of both accounts); `ML_RESULTS.md` l.12 says 48 | No. 57 is the account count; the payment model has 130 inputs; l.12 is stale | "57 account features; the payment model takes 130 inputs" |
| **374/358 and 691/800 trees** | `ML_RESULTS.md` | Yes. I checked all four in the model files | |
| **9e-16** | README, `TECHNICAL_DESIGN.md`; source 8.88e-16 | Yes (rounded) | |

## C. Every use of "accelerator"

Statements that detection does not use it are correct in `README.md` l.59, `ML_RESULTS.md` l.139, 158, 312, 330, `ml/LINUXONE.md` l.7, `LAB_EVIDENCE.md` l.33, `TECHNICAL_DESIGN.md` l.52, `DEMO.md` l.59, `VIDEO_SCRIPT.md` l.21 and `SUBMISSION_TEXT.md` ("no accelerator is used"). Nothing says detection runs on it. The problems are all in the *measurement*:

- the raw counter output is not in the repository and image 10 was never captured (claim 15);
- "Granite" is the 350M base model in the lab container, which the README does not say (claim 15);
- "run on the accelerator" is stronger than the counters and `LAB_EVIDENCE.md` support (claim 16);
- `DEMO.md` step 7 and the video script tell the speaker to say "thousands" for Granite; the count is 36,106, a different order of magnitude from the network's 5,459.

## D. Every use of "recovers", "detects", "accuracy" or "precision" next to synthetic rings

- README l.6 and l.41: "recovers 84% ... and 69%" (claim 1). Missing: in-scope denominator, definition, "same generator".
- Video 2:15: "the demo model recovers 84 percent in the last day". Same.
- `TECHNICAL_DESIGN.md` l.77: "recover 70 to 74% of rings" (claim 32).
- `ML_RESULTS.md` l.179: "recovered 96%, 92% and 87%" is correctly followed by the caution that the rings were "easy and written by the same side that wrote the features". OK.
- `ML_RESULTS.md` l.195 to 199 (second generator): "account models, ... Precision on all candidates is 0.23 to 0.26". True for the four timing-aware sets; transaction-only is 0.18. OK with that qualifier.
- Dashboard `Dashboard.jsx:54`, `Layout.jsx:40/53`: "Accuracy is modest" next to "stand-in rings": the stand-in is out of date (claim 46).
- Nothing in the README states a "precision" for the pig-butchering rings; the 0.74 is on IBM's labels.

## E. The description of my generator

Correct: eight ring shapes, five look-alike types, amounts and channels drawn from the background, aged rings, adversarial look-alikes, the "no tell" design, seeded output. Wrong or loose:

- "injected ... into the last 48 hours" (claim 38).
- "half of them adversarial" is a probability (claim 41).
- `README.md` l.112 says the data row is "Generated by us (`data/rings.py`; the first stand-in is `ml/standin_rings.py`)". Correct.
- `ML_RESULTS.md` s.7 calls the weak spots "aged rings and rings that hold money for hours". My draws show delayed rings are missed at least as often as aged ones (claim 39).
- Nothing says that ring *durations* are 6 to 96 hours and rings start at random times in the 10 days, which is why 48 hours capture only part of each ring.
- Ring ids: injected account ids are `ACC-F00001` and up for every draw, so two draws reuse the same ids for different accounts. Harmless for the model (ids are not features) but anything that joins results across draws by account id would be wrong.

## F. Docs that disagree with the code or each other (not number claims)

- `docs/evidence/README.md` item 4: freshness "about 12 s" in the task file against 9.6 to 9.9 s measured. Already noted there; the other documents were not changed.
- `PLATFORM_RESULTS.md` l.4 refers to "the 2.4 to 2.5 s full rescore"; the committed model's figure is 3.2 s.
- `VERONA_FINAL_TASKS.md` refers to `docs/VIDEO_SCRIPT_RAMANA_DRAFT.md`; PR #40 renamed it to `docs/VIDEO_SCRIPT.md`, so the task file is out of date, not the repository.
- `SUBMISSION_CHECKLIST.md` l.36 describes the project as "Real-time fraud detection"; `DEMO.md` and the video script say never to say real-time.
- `DEMO.md` l.51 says the ring list changes "within about 12 seconds"; the README says about 10.

## G. Open-source resources and licences

**Datasets.** IBM AML: CDLA-Sharing 1.0, confirmed from the Kaggle metadata (`kaggle datasets metadata`). Elliptic: CC BY-NC-ND 4.0, confirmed the same way. Elliptic++: GitHub reports no licence, the README asks for citation (Elmougy and Liu, KDD 2023); the README row says "No licence stated; citation requested", which is right. The DOI link opens (Crossref confirms it; `doi.org` blocks `curl` with 403). Two cautions: the Elliptic++ data comes from the Elliptic data, which is non-commercial and no-derivatives; and CDLA-Sharing 1.0 requires that any redistributed copy of the *data* keep that licence. The repository does not contain the data, but `ml/artifacts/HI-Small/examples/*.json` hold excerpts of IBM-derived payments, and nothing in `ml/artifacts/README.md` says so. Add one line there.

**Software listed in the README, with the licence read from the installed package.** All links open except Uvicorn.

| Package | README link | Licence | Link works |
|---|---|---|---|
| XGBoost | github.com/dmlc/xgboost | Apache-2.0 | yes |
| scikit-learn | scikit-learn.org | BSD-3-Clause | yes |
| pandas | pandas.pydata.org | BSD-3-Clause | yes |
| NumPy | numpy.org | BSD-3-Clause (plus 0BSD, MIT, Zlib, CC0 for bundled parts) | yes |
| SciPy | scipy.org | BSD-3-Clause | yes |
| NetworkX | networkx.org | BSD-3-Clause | yes |
| FastAPI | fastapi.tiangolo.com | MIT | yes |
| Pydantic | docs.pydantic.dev | MIT | yes |
| **Uvicorn** | **www.uvicorn.org** | BSD-3-Clause | **no (the domain does not resolve; use https://uvicorn.dev)** |
| pytest | pytest.org | MIT | yes |
| Podman | podman.io | Apache-2.0 (not checked locally) | yes |
| jupyter-lab-ml | github.com/linuxone-community-cloud/jupyter-lab-ml | not checked | yes |

**Used in the code but missing from the README list** (found by reading every import in `api/`, `ml/`, `data/`, `eval/`, `infra/` and `dashboard/package.json`):

| Missing | Used in | Licence |
|---|---|---|
| React, React DOM, React Router | dashboard | MIT (read from `node_modules`) |
| D3 | dashboard | ISC |
| Vite, `@vitejs/plugin-react` | dashboard build | MIT |
| Vitest, jsdom, Testing Library | dashboard tests | MIT |
| httpx | `api/chat.py`, `infra/bench.py`, `infra/simulator.py`, API tests | BSD-3-Clause |
| psutil | `infra/bench.py` | BSD-3-Clause (not installed here; not read) |
| TensorFlow | `ml/accel_probe.py`, `ml/neural.py` | Apache-2.0 (not read) |
| llama.cpp (`llama_cpp`) | `ml/accel_probe.py` | MIT (not read) |
| IBM Granite models (4.0 350M in the lab container; 4.2 hosted for the chat) | `ml/accel_probe.py`, `api/chat.py` | I could not read the model cards from here; Granite is published under Apache-2.0 but confirm |
| Hugging Face Inference Providers | `api/chat.py` | a hosted service, not open source; say so |
| `perf` (Linux) | `infra/accel_counters.sh` | GPL-2.0 (tool, not linked) |

`TECHNICAL_DESIGN.md` l.59 lists "React, Vite and D3" and says "Full list with links and dataset licenses: README.md": the README has none of the three. No software licence appears anywhere in the README; if the form asks for licences, add a column.

## H. What I could not check

- Any number whose raw output is not in the repository and which needs the VM or a long run: the ring-level and detection-time figures, the HI-Medium results, the LI-Small run, the neural-network comparison and all PLATFORM_RESULTS timings. I checked them against each other and against the code only.
- The headline payment-level PR-AUC (0.428 over three seeds, 0.453 on seed 0; claims 4 and 24). I started `python -m ml.edge_eval HI-Small 0.05 0` on a laptop to reproduce it, and stopped it after about 15 minutes without a result to meet the deadline. It is not reproduced; please have it re-run (it prints both models' account PR-AUC) and keep the output.
- The accelerator counters (claim 15): the VM must stay idle.
- Whether Granite 4.2 answers: the hosted account has no credits.
- Licence texts of Podman, jupyter-lab-ml, TensorFlow, llama.cpp, psutil and the Granite model cards.
