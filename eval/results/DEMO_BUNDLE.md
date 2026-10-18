# Demo bundle: independent re-measurement

Everything here is **synthetic**: IBM's synthetic AML data plus rings and look-alikes from `data/rings.py`, the same generator the demo bundle (`ml/artifacts/HI-Small-pig`) was trained with. Measured 2026-10-18 on a Windows laptop (Python 3.12, XGBoost 3.4.1, pandas 3.0.3), not on the LinuxONE VM. Raw output of Ramana's command: `eval/results/demo_bundle_seeds_5_to_8.txt`. Output of my own check: `eval/results/demo_bundle_check_seed*_history*.json`.

## Result, plainly

**1. The headline gap is inside the spread between draws, but all of it points one way.** On four draws Ramana had never looked at (seeds 5 to 8) the bundle recovered **28 of 37 (76%)** of the in-scope rings in the last 24 hours and **48 of 84 (57%)** in the last 48 hours, against his **36 of 43 (84%)** and **61 of 89 (69%)** on seeds 1 to 4. The differences (8 and 11 points) are smaller than the spread between single draws (62 to 89% at 24 h, 50 to 80% at 48 h; standard deviation about 9 points over the eight draws) and not statistically separable (Fisher exact p = 0.41 and 0.16). But all four of my 48 h draws (50, 57, 61, 61%) are below his pooled 69%, and the best estimate is **80% (64 of 80) at 24 h and 63% (109 of 173) at 48 h over all eight draws**, with 95% intervals of about 70 to 87% and 56 to 70% (rings in one draw share a background, so treat these as optimistic).

**2. One shape disagrees.** Delayed rings: Ramana 10 of 18 recovered in the 48 h window, me 3 of 17 (p = 0.035). Pooled over eight draws delayed is 13 of 35 and aged 10 of 26, which is not distinguishable. His sentence that aged rings are "the shape it misses most" (`ML_RESULTS.md` section 7) is not supported by my four draws.

**3. What the number depends on more than the draw: how much history the scorer is given.** `ml.pig_eval` hands the scorer only the last 48 hours of payments, so every account's features come from at most 48 hours. The model was trained with features from the full history up to each cutoff (`ml/PROTOCOL.md`). Scoring the same rings with the full history up to the end of the period gives much higher numbers (table below). The documents quote the lower regime without saying that a second one exists, and the live demo also builds features from a short history (24 hours at the start, growing to 48 as the replay streams in; `infra/podman_api.sh` sets `NEXUSZ_HISTORY_HOURS=24`). Full history is the condition the model was trained for; it is also the condition in which brand-new fraud accounts stand out most against old background accounts, so it flatters the new-account cue the generator contains (`ML_RESULTS.md` section 7 says the model "is largely recognising brand-new accounts").

**4. In-scope rings are a minority.** The percentages are shares of the rings with at least two *active* fraud accounts in the window. Of 360 injected rings (four draws of 90) only **37 (10%)** at 24 h and **84 (23%)** at 48 h are in scope, because rings start at random times in the 10 days and the slice keeps the last 48 hours. Ramana's draws: 43 and 89 of 360. A sentence that says "recovers 84% of rings" is therefore a statement about about one ring in eight.

**5. "Recovered" is lenient.** `ml.pig_eval` counts a ring as recovered when one detected ring holds at least half of its fraud accounts *that are active in the window* (and at least two). My harness (`eval/metrics.py`) asks for half of *all* the ring's accounts. I recomputed his definition inside my check and it reproduced his printed counts exactly (seed 5: 8 of 10 and 14 of 23). The stricter definition is 14 points lower at 24 h with the 48 h history (62% against 76%), 24 points lower at 24 h with full history (70% against 95%), 14 points lower at 48 h with full history (75% against 89%) and 3 points lower at 48 h with the 48 h history (54% against 57%).

## Recovery under both definitions (seeds 5 to 8 pooled, in-scope rings)

| Features built from | Window | In-scope rings | `ml.pig_eval` definition | My definition (half of all accounts) |
|---|---|---|---|---|
| last 48 h only (as `ml.pig_eval` and the API) | 24 h | 37 | 28 (76%) | 23 (62%) |
| last 48 h only | 48 h | 84 | 48 (57%) | 45 (54%) |
| full history to the end of the period (as trained) | 24 h | 37 | 35 (95%) | 26 (70%) |
| full history | 48 h | 84 | 75 (89%) | 63 (75%) |

Ramana's table (`ML_RESULTS.md` section 7, seeds 1 to 4, 48 h history, his definition): 36 of 43 (84%) and 61 of 89 (69%).

Per draw, 48 h history, his definition, 24 h / 48 h: seed 5: 8 of 10, 14 of 23; seed 6: 5 of 8, 11 of 18; seed 7: 7 of 10, 11 of 22; seed 8: 8 of 9, 12 of 21. Full history: seed 5: 10 of 10, 22 of 23; seed 6: 7 of 8, 16 of 18; seed 7: 9 of 10, 19 of 22; seed 8: 9 of 9, 18 of 21.

By shape, 48 h window, his definition, pooled over seeds 5 to 8 (48 h history / full history): fan-in 7/8 / 8/8, chain 7/7 / 7/7, split 11/12 / 12/12, dispersed 5/6 / 6/6, batched 3/6 / 5/6, mixed 5/11 / 10/11, aged 7/17 / 16/17, delayed 3/17 / 11/17. Delayed rings are the weak shape in both conditions. Ramana's seeds 1 to 4 (48 h history): fan-in 10/10, chain 10/11, split 9/10, dispersed 9/11, delayed 10/18, batched 5/10, mixed 5/10, aged 3/9.

## Account level, with my metrics (`eval/metrics.py`; seeds 5 to 8; mean ± sd over the four draws)

Positives are injected fraud accounts that take part in a laundering payment inside the window; IBM's own laundering accounts are left out of the ranking, as in `eval.run`. Chance PR-AUC is 0.0004. Precision and recall are at the bundle's own threshold (0.609, chosen by Ramana on validation, not by me).

| Features built from | Window | PR-AUC | Precision | Recall | Accounts flagged per draw |
|---|---|---|---|---|---|
| 48 h only | 24 h | 0.810 ± 0.141 | 0.221 ± 0.067 | 0.852 ± 0.109 | 219 to 253 |
| 48 h only | 48 h | 0.555 ± 0.107 | **0.018 ± 0.004** | 0.743 ± 0.061 | **about 6,000** |
| full history | 24 h | 0.951 ± 0.057 | 0.528 ± 0.054 | 0.951 ± 0.065 | 94 to 125 |
| full history | 48 h | 0.956 ± 0.011 | 0.644 ± 0.032 | 0.957 ± 0.015 | 191 to 236 |

**With 48 hours of history and a 48 hour window the bundle's own threshold flags about 6,000 accounts per draw, of which 98% are not injected fraud accounts.** Ranking is still good (PR-AUC 0.56), but the threshold is not usable in that setting. The API does not use this threshold (`bundle.threshold` is not read by `ml/service.py` or `api/`): its ring and alert lists are built from the top fraction of the ranking (`top_fraction` 0.25%, grown to a wider share). So the flood of flags is not what the dashboard shows, but the 'detected rings' count in the 48 h window is still 182 to 187, mostly not pure (next table).

## Rings, with my metrics

| Features built from | Window | Rings detected per draw | Share with at least half of their members in a laundering payment (IBM's included) | Of the 10 riskiest, with an injected account (4 draws, of 40) |
|---|---|---|---|---|
| 48 h only | 24 h | 61 to 64 | 82% | 20 |
| 48 h only | 48 h | 182 to 187 | **33%** | 33 |
| full history | 24 h | 68 to 73 | 87% | 17 |
| full history | 48 h | 148 to 152 | 72% | 28 |

In the 48 h / 48 h setting only 11 to 14 of the 182 to 187 detected rings contain an injected account. "Of the 10 riskiest rings, 35 of 40 contain injected accounts" (`ML_RESULTS.md`) is true of the top of the list; the list is long and mostly something else.

## Look-alike hubs (four draws of 90 hubs: 72 of each type)

How many hubs were active in the slice at all, how many scored at or above the threshold, and how many sit inside a detected ring:

| Type | Active in 24 h / 48 h | Flagged, 48 h history (24 h / 48 h) | In a ring, 48 h history (24 h / 48 h) | Flagged, full history (24 h / 48 h) | In a ring, full history (24 h / 48 h) |
|---|---|---|---|---|---|
| merchant | 72 / 72 | 8 / 12 | 8 / 6 | 0 / 0 | 0 / 0 |
| new customer | 13 / 27 | 3 / 5 | 2 / 0 | 0 / 0 | 0 / 1 |
| payroll | 0 / 22 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 3 |
| landlord | 3 / 12 | 0 / 0 | 0 / 0 | 0 / 1 | 0 / 0 |
| charity | 2 / 10 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

- Counting the way `ml.pig_eval` does (a hub or its settlement account inside any detected ring): 10 of 360 at 24 h and 6 of 360 at 48 h with the 48 h history (Ramana: 6 and 3); 0 and 4 with full history. **With 48 h history all of them are merchants**: 11% of merchant hubs at 24 h. The false alarm the bundle has is the merchant, not the landlord.
- Adversarial look-alikes (money passed on within minutes) are flagged more often than plain ones with 48 h history: 9 of 47 against 2 of 43 at 24 h; 11 of 70 against 6 of 73 at 48 h. With full history 0 and 1.
- New customers (brand-new ordinary accounts, the look-alike made to break the "new account" cue) are flagged 23% (3 of 13) and 19% (5 of 27) with 48 h history. Small counts, but this is the signal that the model does lean on novelty.
- Payroll and charity hubs are barely in the slice (payroll days and donation bursts mostly fall outside the last 48 hours), so they are untested here. Landlords are tested separately in the next section.

## What the demo bundle does with landlords

The default mix barely contains landlords in the slice (3 active in 24 h, 12 in 48 h over four draws: rent day mostly falls outside the last 48 hours), so I injected **landlords only** (`--hard-kinds landlord`: 90 landlord hubs per draw, 360 over seeds 5 to 8; `python -m eval.landlord_summary`). This uses an existing option of `data/rings.py` and changes no existing seed's output. 18 landlords were active in the 24 h window and 53 in the 48 h window.

| Features built from | Window | Active landlord hubs | Scored at or above the threshold | Hub inside a detected ring |
|---|---|---|---|---|
| 48 h only | 24 h | 18 | 1 (6%) | 0 |
| 48 h only | 48 h | 53 | 4 (8%) | 0 |
| full history | 24 h | 18 | 3 (17%) | 0 |
| full history | 48 h | 53 | 10 (19%) | 7 (13%) |

Of the 16 active landlords that forward each rent payment on within minutes (the adversarial kind), 3 (48 h history) and 2 (full history) were above the threshold in the 48 h window. For comparison, the account models in `RESULTS.md` flagged about 55% of landlord hubs, so the demo bundle is far better on this look-alike than those, but it is **not clean**: with the full history one landlord in five is above the threshold and one in eight sits inside a detected ring in the 48 h window. The counts are small (18 and 53 landlords in total).

## Where my check and Ramana's agree and differ

- **Agree:** his definition recomputed in my script gives his printed counts; top-10 rings with injected accounts are close (his 21 of 40 and 35 of 40, mine 20 and 33 at 48 h history); hub counts are close (his 6 and 3 of 360, mine 10 and 6).
- **Differ:** the pooled recovery (8 and 11 points lower, inside the noise); delayed rings (10 of 18 against 3 of 17); and the strictness of "recovered" (3 to 24 points between definitions).
- **Could not do without changing `ml/`:** nothing needed changing. The check uses `ml.service.Scorer.from_transactions` and `ml.bundle.load_bundle`, the same public entry points `ml.pig_eval` uses.

## What I did not test

- The IBM-only bundle on my draws (he reports 0 of 10 and 0 of 20 on one draw).
- Draws other than the default ring mix and look-alike mix, except the landlord-only run above. Payroll and charity hubs are still barely in the slice and were not tested separately.
- The live API (24 h of history growing to 48 h while payments stream in) rather than a batch rescore: the 24 h window with 48 h history is the closest of my settings to the end of the demo replay.
- Anything on the LinuxONE VM, as asked.
