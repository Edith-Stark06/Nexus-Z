# Verona: final tasks (read this first)

For Verona's Claude. Deadline: **Oct 18, 10:00 PM IST** (virtual track). Please have your PRs in by **Oct 18, 14:00 IST** so there is time to merge and fix. Pull `main` first (`git pull origin main`), work on `verona-ann`, open PRs to `main`. No attribution lines in commits or PRs. The repo is public: no keys, addresses, tokens or data files. Say "synthetic" about your data every time.

Your generator and harness are merged (PR #21). Since then Ramana added a demo model trained on your rings, a container deployment and several results. **You are the only person on the team who did not build those numbers, so your job now is to check them independently and to catch anything that overstates.** Do not touch `ml/`, `api/`, `infra/` or `dashboard/` code; if you find a bug there, report it to Ramana with the exact file, line and a reproduction.

## 1. Audit the claims (highest value, about 1.5 hours)

Read these in order: `README.md`, `docs/ML_RESULTS.md` (sections 5 to 8), `docs/TECHNICAL_DESIGN.md`, `docs/PLATFORM_RESULTS.md`, `docs/DEMO.md`, `docs/VIDEO_SCRIPT_RAMANA_DRAFT.md`, `docs/SUBMISSION_TEXT.md`. Make `docs/CLAIMS_AUDIT.md`: a table with one row per number or claim that a judge could quote, and these columns: the claim, where it is written, the file or command it comes from, whether you could find that source, whether the wording is stronger than the source (for example "recovers 84%" without saying "simulated rings", or "real-time" for a 10 second delay). Mark each row OK, OVERSTATED or SOURCE NOT FOUND. Do not edit the other documents; list the exact sentence and a corrected wording and Ramana will apply them. Especially check:

- every use of "accelerator" (detection does **not** use it; only a measurement does),
- every use of "recovers", "detects", "accuracy" or "precision" next to synthetic rings,
- the description of your generator (it is yours, so you know when a sentence misdescribes it),
- numbers repeated in several files (0.45 and 0.15 PR-AUC, 84% and 69%, 12 s and 10 s, 882 s, 34%) that should be identical everywhere.

## 2. Re-measure the demo model on new rings (about 1.5 hours of computer time)

Ramana measured the demo bundle on four random draws of your rings (seeds 1 to 4). Check it on four more he has never looked at, with the repo's own command, on your machine (it needs about 4 to 5 GB of free memory and roughly 4 minutes per seed):

```
python -m ml.pig_eval HI-Small ml/artifacts/HI-Small-pig 5
python -m ml.pig_eval HI-Small ml/artifacts/HI-Small-pig 6
python -m ml.pig_eval HI-Small ml/artifacts/HI-Small-pig 7
python -m ml.pig_eval HI-Small ml/artifacts/HI-Small-pig 8
```
It prints, for the last 24 hours and the last 48 hours, how many of the injected rings with at least two active fraud accounts were recovered, by shape, how many of the 10 riskiest rings contain injected accounts, and how many look-alike hubs sit inside a detected ring. **Do not run these on the LinuxONE VM**: it has to stay idle for the screenshots and the video.

Put the raw output in `eval/results/demo_bundle_seeds_5_to_8.txt` and a short summary in `eval/results/DEMO_BUNDLE.md`: pooled counts for the four seeds, the spread between seeds, and a comparison with Ramana's table (`docs/ML_RESULTS.md` section 7: 84% of 43 rings in 24 h and 69% of 89 in 48 h over seeds 1 to 4). If your pooled numbers differ from his by more than the spread between seeds, say so plainly at the top.

## 3. Check it against your own metrics (about 1 hour)

`ml.pig_eval` was written by Ramana, with his own definition of "recovered" (one detected ring holds at least half of the ring's active fraud accounts, and at least two). Your harness (`eval/metrics.py`) has independent definitions. For one of the four seeds, score the demo bundle's output with your harness (account level PR-AUC on injected fraud accounts, ring recovery, **hub accounts flagged, by look-alike type**) and report whether the two agree. Landlord hubs were your worst look-alike: say what the demo bundle does with them. Put this in the same `eval/results/DEMO_BUNDLE.md`. If you cannot do it without changing `ml/`, write what you would need and stop.

## 4. Two short texts (30 minutes)

- **`docs/DATA_DESCRIPTION.md`**, about 100 words, for the Hack2Skill form's data section: the IBM AML background (with its licence), the rings and look-alikes you generated (what is injected, what is real), the open dates (synthetic), and what is **not** real.
- **Open-source and licence list check.** `README.md` has an "Open-source resources used" section. Check that every library the code imports (look at `api/requirements.txt`, `dashboard/package.json`, and the imports in `ml/`, `data/`, `eval/`, `infra/`) is listed with a working link and the right licence. List anything missing or wrong in `docs/CLAIMS_AUDIT.md` under its own heading. The datasets: IBM AML is CDLA-Sharing 1.0, Elliptic is CC BY-NC-ND 4.0, confirm both on their pages.

## 5. Update the pitch numbers (20 minutes)

`eval/results/PITCH_NUMBERS.md` is what Tushar quotes. Add a short section on the demo bundle with your own pooled numbers from task 2, and the rule for how to say them: simulated rings, same generator for training and testing, "aged" rings are the weak spot, the IBM-only model finds none. Remove or fix anything there that is now out of date.

## Do not

- Change the generator's output for an existing seed (it would silently change every number).
- Run anything heavy on the VM, or push data, models or caches.
- Soften a weak result. If your check disagrees with Ramana's number, the disagreement is the finding.

## Tell Ramana when done

A short message: what is merged, what disagreed with the docs, and what you could not do.
