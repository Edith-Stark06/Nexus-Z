# Handoff for Verona's Claude: data and evaluation (workstream A)

You are the AI assistant working with **Verona Ann** on NEXUS Z, a graph-based fraud ring detector built for the IBM Z Datathon 2026. This file tells you what to do. Read it fully, then start at "Your tasks". Repo state described here: `main` at merge commit `0462796` (2026-10-17).

## 1. Read these first, in this order

1. **The architecture flow (use it as your map):** https://claude.ai/artifact/SHz4vHQrEPCE8Q9mQ2fLdr
   If you have the Artifact tool, read it with `action: "read"`. If not, ask Verona to open it and paste the text; the essentials are in section 2.
   It was written before the ML code existed. Where it disagrees with the repo docs, **the repo docs win**. Differences are listed in section 2.
2. `README.md`, then `docs/TEAM_SPLIT.md` (who owns what).
3. `ml/PROTOCOL.md` (the no-look-ahead rule your metrics must follow).
4. `docs/ML_RESULTS.md` (what has been measured, and its weaknesses). Section 5 is about the stand-in rings you are replacing.
5. `ml/README.md` (how to run the ML code).
6. `ml/standin_rings.py` and `ml/standin_eval.py` (the stand-in you are replacing; read the module docstring).

## 2. Architecture in one screen

```
OFFLINE: train and measure
  Data sources (A: you) -> Time split (A) -> Train models (B) -> Model bundle (B) -> Evaluation (A: you) -> Pitch numbers (D)
ONLINE: score as transactions arrive
  Transaction stream (C) -> Incremental graph (C) -> Refresh features (B) -> Score + rings (B) -> Explain + alert (B) -> Query API (C) -> Dashboard / victim warning (D)
The model bundle is the only thing that crosses from offline to online.
```

Owners: **A Verona (you):** `data/`, `eval/`, branch `verona-ann`. **B Ramana:** `ml/`, `ramana-sree`. **C Giridharan:** `api/`, `infra/`, `giridharan-re`. **D Tushar:** `dashboard/`, `pitch/`, `tushar-biswas`.

Where the artifact is out of date: (1) the ML core is built, so the "model functions" contract is real (`ml/service.py`); (2) serving does not use scikit-learn or the SHAP package, because they do not build on the s390x VM; (3) "refresh features, dirty nodes only" is **not** implemented: the backend rebuilds everything every few seconds. The owner names on the artifact are current.

## 3. The project in five lines

- Pig-butchering scams: many victims pay a few collector accounts, money moves through mule chains in minutes, and leaves at a cash-out. Each payment looks ordinary alone, so the signal is in the network and the timing.
- The system scores accounts, groups high-risk accounts into rings, explains each flag, and warns likely victims.
- Scoring runs on an IBM LinuxONE (s390x) VM. Training happens elsewhere (laptop, Kaggle).
- Evidence we need: graph features beat transaction-only; rings are recovered; legitimate look-alikes are not flagged; the evaluation is not circular.
- **Everything reported must be measured by a run.** No projected or invented numbers.

## 4. Where things stand

Done and in `main`:
- `data/ibm_aml.py`: loader for the IBM AML files (`load_transactions`, `load_with_index`, `load_patterns`, `primary_period`, `time_split`, `account_labels`), `data/paths.py`, `data/profile_ibm_aml.py`. Run `python -m data.profile_ibm_aml HI-Small` for a profile.
- `ml/standin_rings.py`: a **stand-in** generator the ML side wrote so the pipeline could be tested before yours exists. Four ring shapes (fan-in, dispersed, slow, chain), four legitimate look-alikes (merchant, payroll, landlord, charity). It is simple, written by the person who wrote the features, and therefore **circular**. Your generator replaces it.
- `ml/standin_eval.py`, `ml/ring_eval.py`, `ml/ablation.py`, `ml/detection_time.py`: ML-side evaluations. Useful, but they are not independent evidence.

Not done (yours): the real generator, the contract files, an independent evaluation harness, the final ablation table.

Known problems in the IBM data (details in `docs/ML_RESULTS.md` and the dataset README):
- About 1,100 rows fall after the stated date range and are 59% laundering. Always use `primary_period()`.
- Amounts are in many currencies with no exchange rates.
- There is no account open date. About 85% of accounts first appear on day 1.
- The `ACH` payment format carries 87% of laundering rows. A generator that makes rings use ACH hands the model a free tell. Draw channels and amounts for injected payments from the **background** distribution.
- Only about 1% of accounts touch a laundering transaction. Labels live on transactions.

## 5. Your tasks, in order

### Task 1: get the data and run what exists (about 30 minutes)

Datasets are not in git. Use the Kaggle CLI (needs a Kaggle account and API token):

```
kaggle datasets download ealtman2019/ibm-transactions-for-anti-money-laundering-aml -f HI-Small_Trans.csv    -p <DATA>/ibm-aml --unzip
kaggle datasets download ealtman2019/ibm-transactions-for-anti-money-laundering-aml -f HI-Small_accounts.csv -p <DATA>/ibm-aml --unzip
kaggle datasets download ealtman2019/ibm-transactions-for-anti-money-laundering-aml -f HI-Small_Patterns.txt -p <DATA>/ibm-aml --unzip
kaggle datasets download ellipticco/elliptic-data-set -p <DATA>/elliptic --unzip
```

Then `export NEXUSZ_DATA_DIR=<DATA>` (Windows PowerShell: `$env:NEXUSZ_DATA_DIR="..."`). Licenses: IBM AML is CDLA-Sharing 1.0; Elliptic is CC BY-NC-ND 4.0. Never commit data. HI-Small is about 450 MB and needs about 4 GB of RAM to load; **do not run HI-Medium locally** (32M rows). Heavy runs go to Kaggle CPU notebooks: read `ml/KAGGLE.md`.

Acceptance: `python -m data.profile_ibm_aml HI-Small` prints a profile, and `python -m pytest ml/tests api/tests -q` passes.

### Task 2: build the real ring generator in `data/` (the main job)

Create `data/rings.py` with this interface (the same as the stand-in, so one import line swaps it in):

```python
RING_KINDS: list[str]   # names of your ring shapes; ml/standin_eval.py reports recovery per kind
def inject(tx: pd.DataFrame, n_rings: int = 90, n_hard: int = 90, seed: int = 0) -> Injected
# Injected(tx, rings, hard)
#   tx    background + injected rows, columns exactly as data.ibm_aml.load_transactions returns:
#         tx_id, ts, src, dst, amount, currency, channel, amount_received, receiving_currency, is_laundering
#   rings list of dicts: pattern_id, type, first_ts, last_ts, accounts (set of FRAUD-NETWORK account ids), events [(ts, account)]
#   hard  list of dicts: type, accounts (set of hub/settlement ids), hub
```

Design requirements (these exist to reduce circularity; the weaknesses of the stand-in are listed in `docs/ML_RESULTS.md` section 5):
- **Pig-butchering shape:** victims (real background accounts, not fraud) fan in to a few collectors (new accounts), money moves through mule layers to cash-out. Vary victim count, collector count, layer depth, ring duration, deposit sizes.
- **Vary timing more than the stand-in does:** include rings that delay forwarding (hours to days), forward in batches, split amounts, and mix fast and slow hops inside one ring. At least some rings should defeat a simple "money leaves within minutes" rule.
- **Hard negatives (legitimate look-alikes):** merchants, payroll, landlords, charities, as in the plan. Make some adversarial: a merchant that settles quickly, payroll that passes money through within minutes, a charity with a donation burst, a legitimate account that is new.
- **Labels:** deposits from victims are **not** laundering (`is_laundering = 0`) and victims are not fraud accounts. Every hop from a collector onward is laundering (`1`). Hub accounts are never fraud.
- **No tells:** channels and amounts drawn from the background distribution. New account ids must not collide with real ones (the stand-in uses `ACC-F....`, six hex digits starting with F).
- **Reproducible:** same seed, same output. Write unit tests (see `ml/tests/test_standin_rings.py` for the invariants worth testing).
- Ask Ramana for any ring shape or look-alike you cannot decide.

Acceptance: `inject()` plus tests in `data/`; the invariants above hold; shapes and timing are visibly more varied than the stand-in.

### Task 3: export the data contract files

Write an exporter that turns an `Injected` result into the contract in `docs/TEAM_SPLIT.md` section 3. Pseudonymized ids only (`ACC-xxxxxx`).

| File | Columns |
|---|---|
| `transactions.csv` | `tx_id, ts, src, dst, amount, channel` (`ts` is UTC ISO 8601) |
| `accounts.csv` | `account_id, opened_at` |
| `labels.csv` | `account_id, is_fraud, ring_id, role` with role one of victim, collector, mule, cashout, none |
| `links.csv` (optional) | `account_a, account_b, link_type` with link_type device, ip or beneficiary |

Add the optional column `legit_hub_type` (merchant, payroll, landlord, charity) to `labels.csv` for hubs. **It must never be a model feature.** Tell Ramana which columns exist.

Account open dates: IBM has none. If you assign them, be careful: if only fraud accounts are new, "account age" becomes a label leak by construction. Make some fraud rings use aged accounts and some legitimate hubs and customers new. The ML side does not use account age today; if you provide it, tell Ramana and he will add a feature.

### Task 4: run the ML pipeline on your data

The ML code accepts any transaction table:

```python
from ml.dataset import make_snapshots
snaps = make_snapshots("HI-Small", tx=your_tx, tag="-yourtag")   # your_tx restricted to the primary period
```

Make `ml/standin_eval.py` call your generator instead of the stand-in. That file belongs to Ramana: change **only** the `from .standin_rings import RING_KINDS, inject` line (point it at `data.rings`, which must provide both names), and tell Ramana. Run it for at least 3 seeds and record the results.

### Task 5: build the independent evaluation harness in `eval/`

You own the metrics. Write them yourself, against your own ground truth, calling the ML code only for scores and rings:
- Account level: precision, recall, F1, **PR-AUC** (not ROC-AUC alone: fraud is about 1 in 1,000).
- Ring level: **recovery** (a true ring is found if one detected ring holds at least half of its fraud accounts), **purity**, **time-to-detection** (replay the test window in steps, scoring only with data up to each step; `ml/detection_time.py` is a reference, write your own).
- **Hard-negative false-positive rate**: how many look-alike hubs get flagged.
- **The ablation table:** the same XGBoost with transaction-only features, then + behavioral, then + graph. `ml/ablation.py` has `FEATURE_SETS`; `ml.model.fit_model`, `ml.model.fit_calibration`, `ml.model.score` and `ml.rings.detect_rings` are the public functions. This table is the strongest evidence in the pitch, so own it end to end.
- Follow `ml/PROTOCOL.md`: split by time, features only from edges up to the cutoff, thresholds chosen on validation and applied to test, report the new-accounts-only number too.
- Report **variation**: at least 3 generator seeds, and say which differences are inside the noise. The stand-in results varied a lot between seeds (one model went from 0.7 to 0.12 on one seed).

Acceptance: `eval/` runs from one command and writes a results file (for example `eval/results/RESULTS.md`) with the tables above.

### Task 6: robustness and hand-over

- Re-run with different ring mixes and with the adversarial look-alikes on. Report what breaks.
- Give Tushar (pitch) the final table and its caveats, as a short file he can lift numbers from. Give Ramana the ground-truth files and anything the model missed.
- Also add an Elliptic loader to `data/` if you want it there (`ml/elliptic.py` currently reads the files directly).

## 6. Rules

- Work on branch `verona-ann`. Open pull requests into `main`; Ramana (team lead) merges. Commit small and often.
- Edit only `data/` and `eval/`. `data/ibm_aml.py` is yours (Ramana added `load_with_index` and `load_patterns`; keep them, since `ml/` depends on them). Do not change `ml/`, `api/`, `dashboard/` or `pitch/` except as noted in Task 4. If `ml/` needs a change, tell Ramana.
- The repository is **public**. Never commit data files, API tokens, keys, IP addresses or credentials.
- No real personal data anywhere. All account ids are pseudonymized.
- Report only measured results. Label anything generated by us as synthetic, and say plainly when a result is on stand-in or self-generated data.
- Use your own commit conventions and tooling rules; do not copy any other person's settings.

## 7. Questions to send to Ramana (through Verona)

1. Datathon judging criteria, deadline, and whether the organizers supply a dataset (this decides how much of Task 2 matters).
2. Is the final demo data HI-Small plus injected rings?
3. Should account open dates be part of the data contract?

## 8. Report back

When you finish a task, tell Verona: what you built, the command that runs it, the numbers it produced (with the machine and seed), what surprised you, and what you did not test.
