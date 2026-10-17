# Numbers for the pitch (from Verona's evaluation)

Written for: Tushar (pitch and deck). Every number below comes from `python -m eval.run` on IBM AML HI-Small with rings
injected by `data/rings.py`, mean ± standard deviation over 3 seeds (0, 1, 2), test window, thresholds chosen on validation.
Full tables: `eval/results/RESULTS.md`. Time to detection ran on the default scenario only. Default scenario re-run on the current `ml/` (five feature sets) reproduces the four older rows exactly; the robustness scenarios were measured on the older `ml/` (four feature sets).

**Say "synthetic" every time.** The background is IBM's synthetic AML data. The pig-butchering rings are our own synthetic
injection, designed by the same team that designed the features. This shows the method works on rings of this kind. It
is not evidence of accuracy on real fraud.

## Numbers you can use

| Claim | Number | Where |
|---|---|---|
| Timing and graph features beat transaction-only (injected rings, account PR-AUC) | 0.41 vs 0.18 | default, 3 seeds |
| Same, on new accounts only (the harder case) | 0.70 vs 0.36 | default |
| Rings recovered (one detected ring holds half of a true ring) | 73% vs 62% | default, ±0.14 between seeds |
| Look-alike hubs wrongly flagged (merchants, payroll, landlords, charities, new customers) | 5% vs 14% | default |
| Median time to detect a ring, 6-hour replay steps | about 6 hours; 90% of rings detected | default, graph models |
| Fast rings only | PR-AUC 0.48, recovery 88% | fast-rings-only |

## Say these too, or the numbers mislead

- **Most of the gain comes from timing features, not the graph.** Adding timing to transaction-only gives +0.23 PR-AUC. Adding graph
  features on top gives no further gain (-0.05, then +0.04 with k-core and clustering). The honest line is "behaviour in time
  plus network structure", not "the graph model wins".
- **Precision is low.** About 1 flag in 4 is a real fraud account (precision 0.23 to 0.26 on all candidates).
- **Slow rings are the weak spot.** When all rings hold money for hours or days (batched, delayed, mixed), PR-AUC is 0.25 and
  recovery 60%. Batched rings recover only about 33% in the default mix.
- **Landlords are the worst false alarm.** About 55% of landlord hubs are flagged by the graph models; payroll, merchants and charities are
  flagged close to 0% of the time.
- **Few rings break it.** With only 30 injected rings, PR-AUC falls to 0.02 (recall 0.26). The model needs many ring examples to train on.
- **Burst and motif features add nothing here** (PR-AUC 0.396 vs 0.407 without them, inside the noise). Do not claim they help on this evidence.
- **Seed noise is large.** Only 18 to 27 true rings fall in each test window; differences of a few hundredths are inside the noise.

## Do not claim

- Accuracy on real pig-butchering or real bank data.
- "Graph features improve detection" without the timing caveat. On the Elliptic Bitcoin data they added nothing (see `docs/ML_RESULTS.md`).
- Any accelerator use on IBM LinuxONE. The scoring runs on CPU.
