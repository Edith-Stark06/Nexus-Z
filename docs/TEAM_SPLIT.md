# NEXUS Z: Team Split

IBM Z Datathon 2026 | 24-hour build | 4 people, 4 workstreams

Each workstream owns its own folder, so nobody edits the same files. Streams meet at two agreed interfaces (section 3), which are fixed in the first hour.

## 1. Workstreams

| # | Owner | Workstream | Owns (folder) |
|---|---|---|---|
| A | Tushar Biswas | Data and evaluation | `data/`, `eval/` |
| B | Giridharan R E | Graph, features and models | `ml/` |
| C | Ramana Sree K V (leader) | Platform, API and integration | `api/`, `infra/` |
| D | Verona Ann | Dashboard, victim warning and pitch | `dashboard/`, `pitch/` |

### A. Data and evaluation: Tushar
- Synthetic pig-butchering ring generator: victim fan-in, collectors, mule chains, cash-out. Vary ring size, shape and timing.
- Hard negatives: merchants, payroll, landlords, charities that look like hubs.
- Load the public background data (IBM AML, Elliptic) after confirming availability and license. Fall back to purely synthetic background if needed.
- Time-based train/test split, and ground-truth ring labels.
- Metrics code: precision, recall, F1, PR-AUC, ring recovery, purity, time-to-detection, hard-negative false-positive rate.
- Ablation table: transaction-only features vs graph features. This is our strongest evidence, so own it end to end.

### B. Graph, features and models: Giridharan
- Graph build (accounts as nodes, timed weighted transfers as edges).
- Structural, behavioral and community features. Compute them only from edges available at scoring time, to avoid leakage.
- Baseline XGBoost (transaction-only) and graph-feature XGBoost, with class weighting.
- Community detection (Louvain/Leiden), ring score, victim identification.
- SHAP per account and ring-level summaries.
- Saves the trained model and exposes plain Python functions: `score_account`, `get_ring`, `explain`.

### C. Platform, API and integration: Ramana
- First 3 hours: L1CC (LinuxONE Community Cloud) access, repo, and an s390x check that XGBoost, SHAP, numpy and the graph library install. Pin working versions and tell the team immediately if anything fails.
- Docker setup on LinuxONE.
- FastAPI service: `POST /transactions`, `GET /accounts/{id}`, `GET /rings`, `GET /rings/{id}`, `GET /alerts`.
- Streaming simulator, incremental graph updates, and **measured** latency (no placeholder numbers).
- Merges everyone's work, keeps `main` working, and does final testing and the Hack2Skill submission.

### D. Dashboard, victim warning and pitch: Verona
- React + D3 dashboard from the existing design: force graph, alert queue, SHAP panel, time slider replay.
- Victim warning preview ("Check before you send") and the protection screen.
- Builds against mock JSON first, then switches to the real API.
- Pitch deck, README, demo script and the Z platform story. Numbers come from A (accuracy) and C (latency).

## 2. Timeline

| Hours | A: Data | B: ML | C: Platform | D: Dashboard |
|---|---|---|---|---|
| 0-3 | Generator v1 + schema | Set up env, stub functions | L1CC, s390x check, repo | Project scaffold, mock JSON |
| 3-8 | Hard negatives, split, background data | Graph build, features, baseline | Docker, API skeleton | Graph view, alert list |
| 8-13 | Metrics + ablation table | Graph model, rings, SHAP | Ingest endpoint, simulator | Detail panel, time slider |
| 13-18 | Robustness runs (varied shapes) | Tuning, victim identification | Incremental updates, latency | Wire to real API |
| 18-22 | Final numbers | Final model freeze | Integration, demo scenario | Warning screens, polish |
| 22-24 | Results for deck | Bug fixes | Final test, submission | Deck, README, demo rehearsal |

**Critical path:** A's generator v1 unblocks B, and B's functions unblock C. Ship A's first small dataset within 3 hours, even if rough.

## 3. Interfaces to agree in hour 1

**Data (A to B):** `data/transactions.csv` with columns `tx_id, ts, src, dst, amount, channel`. `data/labels.csv` with `account_id, is_fraud, ring_id, role` (role is victim, collector, mule or cash-out). Pseudonymized IDs only, like `ACC-7F3A`.

**Model (B to C):** Python functions that return plain dicts:
- `score_account(id)` returns risk score and SHAP reasons.
- `get_ring(id)` returns members, edges, timeline, ring score and top reasons.

**API (C to D):** JSON shapes for `/rings`, `/rings/{id}`, `/accounts/{id}`, `/alerts`. C posts example responses in the first 3 hours so D can build against them.

## 4. Working rules
- One branch per workstream (`data`, `ml`, `api`, `dashboard`). Merge to `main` through Ramana, small and often.
- No real personal data anywhere. Report only measured results.
- Scope stays: one typology (pig-butchering), one model family (XGBoost). GNN and consortium mode are future scope.
- Open questions to settle early: judging criteria, submission deadline, and whether the datathon supplies a dataset (decides how much of A can be skipped).
