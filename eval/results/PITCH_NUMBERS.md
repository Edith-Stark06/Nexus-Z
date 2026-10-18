# Numbers for the pitch (from the data and evaluation workstream)

For whoever quotes numbers in the deck or the video. Every number below comes from `python -m eval.run`, `python -m eval.demo_bundle_check` or Ramana's `python -m ml.pig_eval`, on IBM AML HI-Small with rings injected by `data/rings.py`, test window, thresholds chosen on validation. Full tables: `eval/results/RESULTS.md` (account models) and `eval/results/DEMO_BUNDLE.md` (demo bundle). A line-by-line check of what the documents claim is in `docs/CLAIMS_AUDIT.md`.

**Say "synthetic" or "simulated" every time.** The background is IBM's synthetic AML data. The pig-butchering rings are our own simulation, made by the team that designed the features, and the demo model was trained on rings from the same generator. This shows the method can learn and find rings of this kind. It is not evidence of accuracy on real fraud.

## The demo bundle (the model the demo shows): what to say

Say this, in these words or close to them:

> "On simulated rings from the same generator it was trained with, a different random draw each time, the demo model recovered 80 percent of the rings that had at least two active fraud accounts in the last 24 hours, and 63 percent in the last 48 hours. That is eight draws pooled, 64 of 80 and 109 of 173 rings; single draws range from about 50 to 90 percent."

Rules for saying it:

1. **Use 80% and 63%, not 84% and 69%.** The earlier pair is from four draws; my four new draws gave 76% and 57%; pooled over all eight it is 80% and 63%. Single draws vary by about 9 points.
2. **Say "simulated rings, same generator for training and testing"** in the same sentence.
3. **Say "of the rings with at least two active fraud accounts in the window".** That is about one injected ring in eight at 24 hours and one in four at 48 hours; the rest have fewer than two active accounts in the window. Never say "recovers 80 percent of rings" alone.
4. **Say "recovered" or "found", never "detects pig-butchering" or "accuracy".** A ring is recovered when one detected ring holds at least half of its fraud accounts that were active in the window.
5. **Aged and delayed rings are the weak spots.** Over eight draws in the 48 hour window: aged 10 of 26, delayed 13 of 35, against about 90% for fan-in, chain and split rings.
6. **A model trained only on IBM's labels finds none of them:** 0 of 10 and 0 of 20 on one draw. That is the honest measure of a model that has not seen the typology.
7. **If asked about precision or a threshold, do not quote one.** The bundle's own threshold flags about 6,000 accounts in a 48 hour window when the model is given 48 hours of history (precision under 2%), and about 200 when it is given the full history (precision 0.64). The result depends on how much history the system is given, which the deck should not hide if asked.
8. **If asked about false alarms:** with 48 hours of history, merchant look-alikes are the problem (11% of merchant hubs ended up inside a detected ring in the 24 hour window); with full history none did. Landlord look-alikes (rent paid in, forwarded within hours): with the full history, 10 of 53 active landlord hubs (19%) scored above the threshold and 7 (13%) sat inside a detected ring in the 48 hour window; with 48 hours of history 8% and none. Small counts, so say "some", not a percentage.
9. **Latency:** about 10 seconds for a new payment to appear on the idle VM, up to about 36 seconds while payments stream in. Never "real time" or "instant".

## Account models (not the demo bundle): numbers you can use

These are for the account-level XGBoost models on rings from `data/rings.py`, 3 seeds, mean ± standard deviation. The committed payment-level model and the demo bundle were not run through this harness except as in `DEMO_BUNDLE.md`.

| Claim | Number | Where |
|---|---|---|
| Timing and graph features beat transaction-only (injected rings, account PR-AUC) | 0.41 vs 0.18 | default, 3 seeds |
| Same, on new accounts only (the harder case) | 0.70 vs 0.36 | default |
| Rings recovered (one detected ring holds half of a true ring's accounts) | 73% vs 62% | default, ±0.14 between seeds |
| Look-alike hubs wrongly flagged (merchants, payroll, landlords, charities, new customers) | 5% vs 14% | default |
| Median time to detect a ring, 6-hour replay steps | about 6 hours; 90% of rings detected | default, graph models |
| Fast rings only | PR-AUC 0.48, recovery 88% | fast-rings-only |

Say these too, or the numbers mislead:

- **Most of the gain over transaction-only comes from timing features, not the graph.** Adding timing gives +0.23 PR-AUC; adding graph features on top gives no further gain (-0.05, then +0.04 with k-core and clustering). The honest line is "behaviour in time plus network structure", not "the graph model wins".
- **Precision is low.** About 1 flag in 4 is a real fraud account (0.23 to 0.26 on all candidates) for the account models with timing.
- **Slow rings are the weak spot.** When all rings hold money for hours or days (batched, delayed, mixed), PR-AUC is 0.25 and recovery 60%.
- **Landlords are the worst false alarm for the account models:** about 55% of landlord hubs are flagged by the graph models. The demo bundle, tested on landlords only, flagged 8% to 19% of the active ones (see `DEMO_BUNDLE.md`).
- **Few rings break it.** With only 30 injected rings, PR-AUC falls to 0.02 (recall 0.26).
- **Burst and motif features added nothing for the account models** (PR-AUC 0.396 vs 0.407, inside the noise). Ramana found they help the payment model; I did not test that.
- **Seed noise is large.** Only 18 to 27 true rings fall in each test window; differences of a few hundredths are inside the noise. The six robustness scenarios were measured on the older `ml/` (four feature sets); the default scenario re-run on the current `ml/` reproduces the four older rows exactly.

## Do not claim

- Accuracy on real pig-butchering or real bank data.
- "Warns the next victim before they pay" or "victim warnings sent": the system lists accounts that recently paid into a flagged ring, nothing is sent, and the rule has not been evaluated.
- "Graph features improve detection" without the timing caveat. On the Elliptic Bitcoin transaction data they added nothing; on the Elliptic++ wallet data they helped (`docs/ML_RESULTS.md` sections 1 and 9).
- Any accelerator use for detection. The scoring runs on CPU. The accelerator counts (0 for trees, thousands for a network and a 350M Granite model) have no saved output yet, so quote them only after `bash infra/accel_counters.sh` has been run and its output kept.
- That the Assistant is IBM's language model writing the answers. Today the hosted answer writer on the VM is NVIDIA's Nemotron through NVIDIA's free API; IBM Granite Embedding on the VM picks the topic when that is off; hosted IBM Granite (Hugging Face, watsonx.ai) has never answered (`docs/CHATBOT.md`).
