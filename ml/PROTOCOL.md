# Label and time protocol

One rule keeps the model honest: **a feature may only use transactions at or before the moment it is scored.**

## Snapshots

The primary period of a dataset (tail dropped, see `data.ibm_aml.primary_period`) is cut by time into train, val and test (60/20/20 of rows). For each split k there is one snapshot at its end time `T_k`:

| Piece | Definition |
|---|---|
| Features | Computed from **all** transactions with `ts <= T_k` (full history, not just the window) |
| Candidates | Accounts with at least one transaction inside window k |
| Label | 1 if the account is a party to a laundering transaction inside window k, else 0 |
| Normalizers | Per-currency median amount, taken from the **train** window only |

The model is fit on the train snapshot, early-stopped and thresholded on val, and reported on test.

## Why this is not leaky

- Features at `T_k` never read a transaction after `T_k`. The label column `is_laundering` is never a feature.
- The streaming API follows the same rule: when a transaction arrives, features use edges up to that moment.
- Thresholds and early stopping use val only. Test is read once.

## Two caveats, reported with every result

1. **Repeat accounts.** An account that was positive in an earlier window can be positive again in a later one. `Snapshot.seen_positive` marks them, and results are reported both on all candidates and on `new accounts only` (never positive before). The second is the harder and more honest number.
2. **Detection, not prediction.** The label window overlaps the feature history, so the features can see the laundering transactions themselves. That is correct for a system that flags rings as they form, and it is why time-to-detection is measured separately on rings.

## Feature groups (for the ablation)

| Group | What it holds |
|---|---|
| `TX_COLS` | Each account's own transaction aggregates: counts, amounts, channel mix, self-transfers, cross-currency share |
| `BEHAVIOR_COLS` | Timing: velocity, bursts, pass-through time (money in, then out) |
| `GRAPH_COLS` | Who it connects to: distinct counterparties, fan-in ratio, PageRank, neighbor stats, 2-hop reach, reciprocity |

Not yet built: k-core, clustering coefficient and community features. Hubs with tens of thousands of counterparties make exact clustering impractical, so it will be computed on a degree-capped graph.

## Known limits of the IBM AML data

No account open date (so account age is not used), mixed currencies without exchange rates (amounts are normalized per currency), and payment format alone is a strong signal (ACH carries most laundering rows).
