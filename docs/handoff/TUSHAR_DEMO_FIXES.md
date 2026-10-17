# Tushar: dashboard fixes for the demo (read this first)

For Tushar's Claude. Deadline: **Oct 18, 10:00 PM IST** (virtual track). Please open the PR to `main` by **Oct 18, 12:00 IST** so Giridharan can record the video with the final screens. Pull `main` first. No attribution lines in commits or PRs. The repo is public: no keys, IPs or tokens.

Ramana ran your dashboard (`main`, PR #13) against the real model API (`NEXUSZ_BACKEND=model`, 654k payments) and looked at every screen in a browser. All 24 of your tests pass and it builds. It already works with live data (the "LIVE API" badge shows). What follows is what is wrong or misleading **on real data**, in priority order. Fix these, nothing else.

## How to run it against the real API

```
# terminal 1, from the repo root (needs the IBM data folder; ask Ramana, or use the VM tunnel below)
NEXUSZ_BACKEND=model NEXUSZ_DATA_DIR=<data folder> NEXUSZ_SLICE=HI-Slice python -m uvicorn api.main:app --port 8000
# terminal 2
cd dashboard && npm ci && npm run dev        # http://localhost:3000
```
The API takes about 30 s to start (it builds the first state). The sample-data fallback hides API problems, so **check that the "LIVE API" badge is showing** before you judge a screen. The demo uses the synthetic pig-butchering slice and the typology bundle; `docs/DEMO.md` has the exact commands (API on the VM, SSH tunnel to your laptop, replay). To run it all on your own laptop you need the data folder, so use the tunnel to the VM: ask Ramana for access, or ask him to start the VM API for you.

## Must fix (a judge would notice)

1. **The warning screen shows the wrong account.** `src/pages/Alerts.jsx` links each victim-warning's "Preview" to `/warning/<alert.account_id>`, which is the *payer* (a victim, risk 0%, no ring). The screen then says "This account is flagged as part of a fraud ring... high risk (0%)", role "unknown". The pre-check is for the account being **paid**. The API now sends it: each `victim_warning` alert has a new field **`recipient_id`** (the ring account that was paid; `null` on ring alerts and in the stub data). Link Preview to `/warning/<alert.recipient_id>` and fall back to the ring's page if it is missing. Then `GET /accounts/<recipient_id>` gives the real risk, role and ring.
2. **"victim warnings sent" is false.** We flag likely victims; we send nothing. Change the wording in `src/pages/Dashboard.jsx` (lines 98 and 155), `src/pages/RingDetail.jsx:102` and `src/pages/Alerts.jsx:72,75` to "likely victims flagged" / "No likely victims flagged yet". The ring card on the home page shows "3 victim warnings sent" for **every** ring: it must show the real count of `victim_warning` alerts for that ring (from `/alerts`), or be removed.
3. **Dates read "10 Sept ago".** `relativeTime` in `src/lib/constants.js` compares with the browser's clock (2026), but the data is from 2022, so everything is "years ago" and falls through to a bare date plus "ago". Show the **absolute UTC time** instead, for example `Sep 10, 2022 12:55 UTC`, on the ring cards, the alerts tables and the ring header. The API's `GET /health` has `data_as_of` if you want a "data as of" label in the sidebar.
4. **Stand-in wording is out of date.** `src/pages/Dashboard.jsx:54` and `src/pages/Layout.jsx:39` say "stand-in rings used for testing". Use: "Synthetic data: IBM's AML transactions with simulated pig-butchering rings. Accuracy is modest; many laundering groups are still missed." Keep the pointer to `docs/ML_RESULTS.md`.
5. **Ring ids change between refreshes.** A ring id is a hash of its members, so a ring that grows or splits during a refresh (about every 12 s while data streams in) gets a new id and `GET /rings/{id}` returns **404**. Measured: 18% of ring-detail requests during a load test. When a ring page gets a 404, reload `/rings` and show "This ring was updated" with a link back to the list, not an error. Do not cache ring ids across polls.
6. **"fraud ring" is too strong.** `src/pages/WarningScreen.jsx` says "This account is flagged as part of a fraud ring". We flag; we do not convict. Use "flagged ring" / "a ring under review". (With item 1 fixed this screen is otherwise right: it shows the paid account, its role, ring and risk.)
7. **`tel:0`** on "Talk to my bank" (`src/pages/WarningScreen.jsx:55,141`): remove the link or make it a button that shows "Contact your bank using the number on your card".
8. **External Google Fonts** (`index.html:7-9`): the demo must run on a VM or a laptop without internet. Remove the three `<link>` lines and use the system font stack.

## Should fix (looks unfinished)

9. **Ring header total.** `src/pages/RingDetail.jsx:60` prints `24,717,523.6` with no unit. The data mixes currencies, so label it "total (mixed currencies)" or drop it.
10. **"Why flagged" on the ring page** prints `Paid by ACH+2.67` with no separation (the account page does this well, with a numbered list and a right-aligned value). Reuse the account page's list.
11. **Flow graph.** Nodes have no labels. Show the account id on hover and add a small legend for the role colours. Arrowheads on edges would show direction.
12. **Role words.** Also: some reasons now end in "(absent)", for example "Receiver: many transfers to itself (absent)". That is deliberate: the model is flagging the lack of something. Show the text as the API sends it; do not strip it.
    Roles: The roles are guessed from position in the ring (the data has no role labels). Keep "(estimated role)" wherever a role is shown.

13. **Case summary (new field).** `GET /rings/{id}` now has an optional `summary` string: three to four sentences with the ring's exact facts, what its main signal can mean, and the estimated roles, ending "Verify the accounts before any action; roles are estimates." Show it as a short "Case summary" block at the top of the ring page (under the headline). It is deterministic text from a template and hand-written meanings; nothing is generated by a model. Hide the block if `summary` is missing (stub data).

## Do not

- Say "real-time" or "instant". A new payment shows in about 12 seconds on the VM: say "near real time (about 12 s)".
- Say "fraud" about an individual account. Use "flagged", "under review".
- Claim accuracy. The sidebar and footer text above is the claim.

## Check before you open the PR

- `cd dashboard && npm test && npm run build` pass.
- With the real API running: the home page, one ring, one account, the alerts page and one warning screen (opened from an alert's Preview) each show real values, and the badge says LIVE API.
- Tell Ramana which items you could not do.
