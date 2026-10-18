# NEXUS Z dashboard: an investigation workstation

React 18 + Vite + react-router + d3. It reads the NEXUS Z API and helps an analyst work through one path: **see which groups of accounts were flagged, open one, read its payment graph, inspect the evidence behind its score, and decide what to examine next.**

```
cd dashboard
npm ci
npm run dev          # http://localhost:3000, expects the API at http://localhost:8000 (set VITE_API_URL to change it)
npm test             # vitest, 161 tests
npm run build        # production build into dist/
```

There is no lint or type-check script in this project (it is JavaScript, and ESLint is not installed), so `npm test` and `npm run build` are the available checks.

No external fonts or scripts are loaded, so it runs on a machine with no internet (the VM, a laptop on a tunnel). The font stack falls back to the system fonts; IBM Plex is used only if it is installed locally.

## Design

A light, neutral, IBM Carbon-inspired system written as plain CSS tokens (`src/styles/tokens.css`), not the Carbon packages (no migration, no new dependency).

- **One shell** (`src/pages/Layout.jsx`) on every route, the homepage included: a 48 px header with the product, the six areas (Overview, Investigations, Alerts, Accounts, Assistant, Platform) and the system-status control. Under 1060 px the navigation becomes a drawer. The header is the only dark element.
- **Blue is for interaction and selection.** Red, orange, yellow and green appear only where they state a risk or health condition, and always with a word or a shape beside them. Orange and yellow dots and bars use darker marks of the same hue (`--warn-mark`, `--caution-mark`) because the brighter values are 2.5:1 and 1.7:1 on white.
- **Type**: sans-serif for the interface; monospace only for ids, timestamps and diagnostics.
- **Graph**: a white canvas with no grid; neutral links and ring outlines; blue only for the selection and its connections. Shape (hollow circle, filled circle, diamond, square, dashed circle) carries the estimated role, so colour is never the only cue.

## Screens

| Route | What it is |
|---|---|
| `/` Homepage | Headline, the top flagged rings the API returned drawn as one interactive graph, "How NEXUS Z works" (six steps, each with an implementation status and what it does not do), the architecture and target platform (only documented facts), and a closing call to action that links to the architecture |
| `/overview` | Highest-scored rings, likely victims flagged, and the system-status view |
| `/rings`, `/ring/:id` | **Investigations.** Ring list (search, score and size filters, sort) on the left, the payment graph in the middle, the inspector (ring, account or payment) on the right. Narrow screens get a Rings / Graph / Details switch and fold the graph options away |
| `/accounts` | An exact account lookup, and the highest-scored members of the top returned rings (the API has no list of all accounts) |
| `/account/:id` | One account, with model-generated signal, observed data, inferred role and available actions in separate sections |
| `/alerts` | Filterable, sortable table. Filters live in the address bar |
| `/warning/:id` | A **prototype** of the customer "check before you send" screen on the real `GET /accounts/{id}`. Not connected to any payment flow; nothing is sent to anyone |
| `/assistant` | The existing grounded chat (logic unchanged) |
| `/platform` | The status and provenance view, the raw `/health` response, and a validated form for `POST /transactions` |

## Provenance: four facts, never one "live" light

`src/lib/provenance.js` turns what the API reported into four separate statements, shown in the header control, on Overview and on Platform, and summarised in one line under each page title:

| Fact | Where it comes from |
|---|---|
| API health | whether `/health` answered on the last poll; the time shown is when this browser received it |
| Backend mode | `/health` `backend` (`model` or `stub`). "Model backend" is shown as healthy only when a state has actually been built (`history_transactions` > 0 and `data_as_of` present): a bare HTTP 200 is not enough |
| Source data | `/health` `data_as_of`, the time of the newest payment in the data. It is never derived from the browser clock, and it is documented as historical (2022) synthetic evaluation data, not the present |
| Last refresh | `state_age_seconds`, `refreshes_completed` and `last_rebuild_seconds` from `/health` |

The API does not itself say its data is synthetic; that statement comes from the repository's documentation (README, `docs/ML_RESULTS.md`), and the status panel says so.

## Scores and amounts

- **Ring score** is `risk` on `/rings`: an integer 0 to 100 from a small ring-level model (`ml/ring_score.py`).
- **Account score** is `score` on a ring member and `risk` on `/accounts/{id}`: a decimal 0 to 1 from the account model (`ml/model.py`).

They come from different models, so `77` on a ring and `0.78` on an account are not the same number on two scales. Each is shown on its own scale with its own name (`src/lib/scores.js`, `RiskMeter`), and neither is called a probability of fraud or a finding. Only a ring score is coloured by severity (the 50 and 25 cut-offs are the API's); list rows stay neutral so dozens of red bars do not drown the signal.

The API reports **no currency** and `total_amount` adds amounts of unknown currency, so the dashboard shows no ring total and no currency symbol. Payments are shown as recorded, marked `Amount*`, with a note, and the payment count replaces the total.

## The graph

Accounts are nodes: shape is the estimated role, size is the account score. Each arrow is every payment from one account to another; a thicker line means more payments. Click an account or an arrow to select it: everything outside its direct connections dims and the inspector follows. Scroll to zoom, drag the background to pan, drag an account to move it. Fit, Clear selection (also Esc), Network or Flow layout, colour by role or score, hide a role, find an account, **Focus neighbours** (zooms to the selected account and the accounts it exchanges payments with), and the replay slider (a replay of recorded payments, not a live feed).

**Labels are planned, not guessed** (`labelPlan` in `src/lib/graph.js`). In screen pixels, every account is tried in priority order (selected, then hovered, then its connections, then highest score) and its name is drawn only if the label would not land on another label or on another account. Zooming in gives the labels room, so more of them appear. When some are left out the canvas says how many ("Labels shown for 14 of 18 accounts in view") and the selected account's details stay in the inspector regardless. Line widths and arrowheads keep a constant on-screen size at every zoom.

A **404 on a ring** is treated as information, not an error: ring ids are derived from the ring's members, so a refresh can retire one. The page says so, refreshes the list, keeps the last copy that loaded (marked), and asks `GET /accounts/{id}` for a few of its highest-scored members to show which current rings they are in. It does not retry in a loop.

## Where the data comes from

`src/state/DataContext.jsx` owns the connection and polls `/health`, `/rings` and `/alerts` every 5 s. Every page reads from it.

| State | Meaning |
|---|---|
| connected | `/health` answered on the last poll. A **stub** backend (invented data from the server) gets its own warning banner |
| stale | it answered before and has stopped; the last real results stay on screen, marked |
| unreachable | it never answered. **Nothing is shown, and nothing is faked**: an error, the cause and a Retry. The homepage hero does the same |
| demo sample | only when the analyst clicks "Use the demo sample". Bundled invented data, labelled on every screen. Never mixed with live results |

## What is and is not supported by the backend

- Roles are **estimated** from position in the ring (the data has no role labels), and a likely-victim role is a heuristic that has not been validated. A score is an automated signal for review, not a finding of fraud. Each is said next to the thing it qualifies.
- Alerts cover only the scorer's **10 highest-scored rings** and list **at most 3 likely victims per ring** (and at most 50 alerts). The victim rule (paid into a flagged ring recently) has not been evaluated for accuracy, and its severity is fixed at medium. Nothing is "sent".
- A ring's payments are capped at the most recent 500 (`MAX_EDGES` in `ml/service.py`).
- Reason labels are exactly what the API sends, including "(absent)" and the occasional unlabelled feature name.
- A new payment shows up after the next background rebuild of the model state; Platform shows the numbers. Scoring is a full recompute in micro-batches, not per payment.
- `/health` does not say where the API runs, so the dashboard never claims it is on LinuxONE.
- There is no pre-payment warning endpoint; `/accounts/{id}` is what the prototype screen uses.

## Tests

`npm test` runs 161 tests: the provenance rules (a bare HTTP 200 is not "model active"; the data time is never the browser clock; stub, degraded, stale, unreachable and demo are told apart), score and amount formatting, the label planner (collisions, zoom, forced labels, determinism), the shell and status control, the alerts filters and sorts (numeric severity rank, search across ids and message), the accounts page, the homepage (including that an unreachable API draws nothing and offers a retry), the graph maths, the data provider's connection modes, the explorer's wiring, the payment form, and the older suites (warning screen, payment table, replay, assistant, fallback).

jsdom has no layout engine, so the d3 canvas is replaced by a stand-in in the component tests. The real canvas was exercised separately in Chrome against the real model API: label collisions measured at the overview, zoomed and focused views of a 21-account ring; selection, Focus neighbours, layouts, role hiding, replay, list filters, account lookup, a retired ring id (no retry loop across two poll cycles), an API outage followed by Retry, the opt-in demo sample, and the phone layout with no horizontal page scroll. That browser script is not part of the repository.
