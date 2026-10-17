# Hack2Skill form text (draft)

Portal: IBM Z Datathon - Project Submissions, closes **18/10/2026 10:00:00 PM IST** (read from the portal). Each field allows 1,024 characters. Every number below comes from `docs/ML_RESULTS.md` or `docs/PLATFORM_RESULTS.md`.

## What is the problem you are trying to solve? (445 characters)

Pig-butchering scams groom victims online, then move their payments through collector and mule accounts that forward the money within minutes to a cash-out. Banks see single payments, not the ring behind them, so the money is usually gone before a victim reports it. We need to find the whole ring from payment flow alone, explain why it was flagged in words an analyst can act on, and warn the next likely victim before another payment is sent.

## How are you planning to solve the problem? (Brief overview) (805 characters)

NEXUS Z scores every payment on IBM LinuxONE (s390x, RHEL, rootless Podman). An XGBoost payment-level model uses each payment's amount, channel and hour, how soon the sender received money and the receiver passes it on, and 57 graph and timing features of both accounts. An account's risk is its riskiest payment. Linked high-risk accounts form rings (components, Louvain split, growth into weaker links). Exact TreeSHAP gives reasons; FastAPI and a React dashboard show each ring, its roles, the reasons and likely next victims. On IBM AML HI-Small (time split, no look-ahead) account PR-AUC is 0.45 against 0.15 for an account-level model, and a third of laundering groups are recovered as rings. Trained on the VM in 882 s; a new payment shows in about 12 s. Data are synthetic; no accelerator is used.

## Where each claim comes from

| Claim | Source |
|---|---|
| Account PR-AUC 0.45 against 0.15 (one seed for the committed 57-feature model) | ML_RESULTS.md section 6, choices tested |
| A third of laundering groups recovered as rings (34%) | ML_RESULTS.md section 6, rings table, committed setting |
| Trained on the VM in 882 s | ML_RESULTS.md section 4 |
| New payment shows in about 12 s | PLATFORM_RESULTS.md section 3b |
| No accelerator | TECHNICAL_DESIGN.md, "What we do not claim" |
