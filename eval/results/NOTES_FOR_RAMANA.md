# Hand-over from the data and evaluation workstream (Verona) to Ramana

Written for: Ramana (team lead, ML). Branch `verona-ann`, not yet merged.

## What is in the branch

| Path | What |
|---|---|
| `data/rings.py` | Real ring generator. Same interface as the stand-in: `RING_KINDS`, `inject`, `Injected`. Adds options `kinds`, `hard_kinds`, `adversarial`, `aged_share`. |
| `data/export.py` | Contract exporter: `python -m data.export HI-Small <seed> <out_dir>`. |
| `data/elliptic.py` | Elliptic loader (`ml/elliptic.py` still reads the files directly). |
| `eval/` | Independent metrics (`metrics.py`), one-command harness (`python -m eval.run`), report writer. |
| `ml/standin_eval.py` | One line changed: imports `RING_KINDS, inject` from `data.rings`. Nothing else in `ml/` was touched. |

## What changed compared with the stand-in

- **8 ring shapes** (fan-in, dispersed, chain, batched, delayed, split, mixed, aged); hold times from minutes to days; batched and split forwarding; some rings mix speeds.
- **5 look-alike types**: merchant, payroll, landlord, charity, and **`new-customer`** (a brand-new ordinary account that is paid and spends quickly). Half of the look-alikes are adversarial (fast pass-through).
- **No payment tells**: channel and amount scale are drawn from the clean background. A ring keeps one currency (amounts are scaled by that currency's median).
- **Injected ids** are `ACC-F?????`-style: `ACC-` plus six hex digits starting `F0...` (above any real IBM id). The tests check there is no collision.
- **Victims** are real background accounts that existed before the deposit. Deposits are not laundering.

## Contract files and columns

`transactions.csv`: tx_id, ts (UTC ISO 8601), src, dst, amount, channel.
`accounts.csv`: account_id, opened_at. **Synthetic dates.** IBM has none. The exporter checks that account age alone does not rank fraud:
on HI-Small seed 0 the AUC of "younger is more likely fraud" is 0.537 (0.5 means no signal).
`labels.csv`: account_id, is_fraud, ring_id, role (victim, collector, mule, cashout, none), **`legit_hub_type`** (merchant, payroll, landlord, charity, new-customer, or empty).
**`legit_hub_type` must never be a model feature.** It exists only to count false alarms.
`links.csv`: account_a, account_b, link_type (device, ip, beneficiary). Synthetic; some rings share infrastructure, so do some ordinary accounts.

Known wrinkle: 13 of 1,451 victims on seed 0 have `is_fraud = 1`, because they are real IBM accounts that also appear in IBM's own
laundering rows. The injected labels and all reported metrics are unaffected. Fixing it means excluding IBM laundering accounts from victim
sampling, which changes every seed's output.

## What the model missed (default scenario, test window, from `RESULTS.md`)

- **Batched rings:** recovered about 33% of the time by every feature set.
- **Delayed rings:** 44% to 64%. Mixed rings: 22% (transaction-only) to 72% (graph).
- **Landlord hubs:** flagged about 55% of the time by the graph models (27% with behavioral only).
- **Precision** is 0.23 to 0.26 on all candidates; most flags are wrong.
- **Graph features add nothing over behavioral features** here: PR-AUC 0.413 (behavioral) vs 0.362 (+ graph) vs 0.407 (+ k-core). The gain over transaction-only is timing.
- With **30 rings** instead of 90, PR-AUC drops to 0.02. With a slow-rings-only mix it drops to 0.25.

## Circularity (say it in the pitch)

You designed the features; the rings and look-alikes were designed by our side, from the same idea of pig-butchering. The generator is more varied
than the stand-in but is still our idea of the scam. Nothing here is observed fraud.

## Things I did to avoid wrong results

- `ml.standin_eval` caches snapshots as `-standin{seed}` in `<data>/cache`. Your old stand-in caches have the same names, so a run with `data.rings` would silently load
  the old rings. I ran it through a wrapper that renames the tag (`-datarings{seed}`) and left your caches untouched. Consider changing the tag in that file.
- The repo now has a `.venv` folder that is not in `.gitignore`. I did not create or commit it.

## Questions for you (from the handoff, section 7)

1. Judging criteria, deadline, dataset rules: `docs/SUBMISSION_CHECKLIST.md` says final submission Oct 18, 10:00 IST, four criteria of 10 points each, no dataset supplied. Please confirm in the portal, and ask how pre-kickoff work counts.
2. Final demo data: I recommend HI-Small plus injected rings, with Elliptic shown only as the check that graph features add nothing on a real graph.
3. Account open dates: I recommend keeping `opened_at` in the contract, labelled synthetic, and not used as a feature unless the age-leak check is re-run.

## Task 4: `ml/standin_eval.py` with `data.rings` (old `ml/`, FEATURE_VERSION 2, before merging main)

Run through a wrapper that renames the cache tag (see above), seeds 0, 1, 2, HI-Small. Account-level test result on injected fraud accounts:

| Features | PR-AUC seed 0 / 1 / 2 | Hub accounts flagged (seed 0 / 1 / 2) |
|---|---|---|
| transaction-only | 0.177 / 0.167 / 0.193 | 11 of 64 / 18 of 81 / 25 of 72 |
| + behavioral | 0.366 / 0.447 / 0.427 | 8 of 64 / 10 of 81 / 5 of 72 |
| + graph | 0.327 / 0.368 / 0.392 | 4 of 64 / 6 of 81 / 7 of 72 |
| + k-core, clustering, components | 0.413 / 0.396 / 0.411 | 4 of 64 / 7 of 81 / 7 of 72 |

These agree with `eval.run` (full set 0.407 ± 0.010 over the same seeds). Ring recovery at the flagged fraction chosen on val, full set: 0.667, 0.625, 0.889
(18 to 24 true rings per seed, so one ring moves recovery by 4 to 6 points). `ml/` has since moved on (FEATURE_VERSION 4, a "+ bursts and motifs" row); see the follow-up in RESULTS.md.
