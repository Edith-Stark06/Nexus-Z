# NEXUS Z dashboard: an investigation workstation

React 18 + Vite + react-router + d3. It reads the NEXUS Z API and helps an analyst work through one path: **observe suspicious activity, select a ring, explore its accounts and payments, inspect the evidence, decide what to examine next.**

```
cd dashboard
npm ci
npm run dev          # http://localhost:3000, expects the API at http://localhost:8000 (set VITE_API_URL to change it)
npm test             # vitest, 118 tests
npm run build        # production build into dist/
```

No external fonts or scripts are loaded, so it runs on a machine with no internet (the VM, a laptop on a tunnel).

## Screens

| Route | What it is |
|---|---|
| `/` Homepage | The front door: headline, a live transaction network of the top flagged rings (or a clearly labelled illustrative one), an interactive "a transaction is a point, the network is the evidence" comparison, the five workflow stages with what each does *not* do, a working preview of the ring explorer, and the LinuxONE target architecture with only documented facts |
| `/overview` Overview | Highest-risk rings, likely victims flagged, and the pipeline's freshness (from `/health`). Every figure is derived from what the API returned |
| `/rings`, `/ring/:id` | **Ring explorer.** Ring list (search, risk and size filters, sort) on the left, the interactive payment graph in the middle, the inspector (ring, account or payment) on the right |
| `/account/:id` | One account: its score and reasons, its direct connections inside its ring, its payments, related alerts |
| `/alerts` | Sortable, filterable table; every row links to the ring, the account and the payment pre-check. Filters live in the address bar |
| `/warning/:id` | A **prototype** of the customer "check before you send" screen, built on the real `GET /accounts/{id}`. Not connected to any payment flow; nothing is sent to anyone |
| `/assistant` | The existing grounded chat (unchanged logic) |
| `/platform` | What `/health` reports, the connection state, and a validated form for `POST /transactions` |

### The homepage

`src/pages/Home.jsx` and `src/components/home/`. Its data comes from `useHomeSource`, which decides what the page may call real:

| Source | When | Label on screen |
|---|---|---|
| live | the API answered and returned rings from its model backend | "Live results · model backend" |
| stub | the API's stub backend is serving invented data | "Stub backend sample" |
| illustrative | the API is unreachable, returned no rings, or the demo sample is selected | "Illustrative transaction network", plus a note that it is invented and not system data |

The hero draws the top three flagged rings as outlined clusters in one graph and starts on the highest-scored collector of the top ring. Hover previews an account's connections; click an account, an arrow or a cluster outline to inspect it (a cluster click zooms to it); search, zoom, fit, reset and a legend that hides roles all work, and every node is keyboard-focusable. The comparison section and the architecture schematic use invented or documented content only, labelled as such; the comparison switches to a tall composition on phones so its labels stay readable. If a ring id disappears between the list and its detail (404), the page says the ring changed during a refresh and refreshes the list; it never shows invented detail.

### The graph

Accounts are nodes: **shape is the estimated role** (hollow circle = likely victim, filled circle = collector, diamond = mule, square = cash-out), size is the model score. Each arrow is every payment from one account to another, pointing the way the money went; thicker means more payments (amounts mix currencies, so they never set a size). Click an account or an arrow to select it: everything outside its direct connections dims and the inspector follows. Scroll to zoom, drag the background to pan, drag an account to move it; Fit, Clear selection (also Esc), Network or Flow layout (roles in columns, in the order money moves), colour by role or by score, label mode, hide a role, find an account, and the replay slider (only payments at or before the chosen time are drawn). Nodes are keyboard-focusable (Enter selects).

## Where the data comes from

`src/state/DataContext.jsx` owns the connection and polls `/health`, `/rings` and `/alerts` every 5 s. The header and a banner always say which of these you are looking at:

| State | Meaning |
|---|---|
| connected | `/health` answered on the last poll. The backend name is shown; a **stub** backend (invented data from the server) gets its own warning banner |
| stale | it answered before and has stopped; the last real results stay on screen, marked |
| unreachable | it never answered. **Nothing is shown, and nothing is faked.** Retry, or choose the demo sample |
| demo sample | only when the analyst clicks "Use the demo sample". Bundled invented data, labelled on every screen. Never mixed with live results |

A **404 on a ring** is treated as information, not an error: ring ids come from the ring's members, so a refresh that regrows or splits a ring can retire its id. The page says so, keeps the last copy that loaded (marked), and asks `GET /accounts/{id}` for a few of its highest-scored members to show which current rings they are in.

## What is and is not supported by the backend

- Roles are **estimated** from position in the ring (the data has no role labels). Risk is an automated signal for review, not a finding of fraud. Both are said where they appear.
- The API's alerts cover only the scorer's **ten highest-risk rings**, and list **at most 3 likely victims per ring**: so "likely victims flagged" exists only for those ten rings, and "3" means 3 or more. The rule (paid into a flagged ring recently) has not been evaluated for accuracy. Nothing is "sent": we flag.
- Ring `total_amount` and payment amounts mix currencies and are shown without a currency.
- Reason labels are exactly what the API sends, including "(absent)" (the model flags the lack of something) and the occasional unlabelled feature name.
- A new payment shows up after the next background rebuild of the model state (minimum interval plus rebuild time); the Platform page shows the numbers. Scoring is a full recompute in micro-batches, not per payment.
- `/health` does not say where the API runs, so the dashboard never claims it is on LinuxONE.
- There is no pre-payment warning endpoint; `/accounts/{id}` is what the prototype screen uses.

## Tests

`npm test` runs: the cluster geometry and merging helpers, the homepage (hero, which data it may call real, comparison, workflow honesty, preview with a changed ring, architecture claims, links and sections), the graph maths (aggregation, neighbourhood, layouts, fitting, link geometry), list filters and sorting, UTC time and risk tone, the data provider's connection modes (including that a failed request never becomes sample data, and that a 404 is told apart from a network failure), the explorer's wiring (select, account lookup, filters, a retired ring id, narrow tabs), the payment form's validation and submit behaviour, and the older suites (warning screen, payment table, replay, assistant, fallback).

jsdom has no layout engine, so the d3 canvas itself is replaced by a stand-in in those tests. It was exercised separately in Chrome against the real model API (select, drag, zoom, pan, fit, layouts, role hiding, find, replay, filters, an unknown ring id, streaming payments with the simulator, the payment form). That browser script is not part of the repository.
