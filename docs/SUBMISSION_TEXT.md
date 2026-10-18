# Hack2Skill form text (draft)

Portal: IBM Z Datathon - Project Submissions, closes **18/10/2026 10:00:00 PM IST** (read from the portal). Each field allows 1,024 characters. Every number below comes from `docs/ML_RESULTS.md` or `docs/PLATFORM_RESULTS.md`.

## What is the problem you are trying to solve? (458 characters)

Pig-butchering scams groom victims online, then push their payments through collector and mule accounts that typically forward the money within minutes to hours to a cash-out. Banks that score payments one at a time see ordinary transfers, not the ring behind them. We need to find the whole ring from payment flow alone, explain why it was flagged in words an analyst can act on, and show which accounts recently paid into it, so that they can be contacted.

## How are you planning to solve the problem? (Brief overview) (1021 characters)

NEXUS Z scores every payment on IBM LinuxONE (s390x, RHEL, rootless Podman). An XGBoost payment-level model (130 inputs) uses each payment's amount, channel and hour, how soon the sender received money and the receiver passes it on, and 57 account features (transaction, timing, graph, structure, burst and motif) of each endpoint. An account's risk is its riskiest payment. Linked high-risk accounts form rings (connected components, Louvain split). TreeSHAP gives the reasons; FastAPI and a React dashboard show each ring, its estimated roles, the reasons and the accounts that recently paid into it. IBM Granite Embedding, running on the VM, powers an assistant that answers analysts' questions from our API. On IBM AML HI-Small (time split) account PR-AUC is 0.43 against 0.15 for an account-level model (three seeds), and a third of laundering groups are recovered as rings. Trained on the VM (15 to 32 min); a new payment shows in about 10 s when idle. All data is synthetic; detection does not use the accelerator.

## Where each claim comes from

| Claim | Source |
|---|---|
| Account PR-AUC 0.43 against 0.15 (three training seeds; 0.45 on one seed with burst and motif features). Not re-run after the claims audit | ML_RESULTS.md section 6; CLAIMS_AUDIT.md rows 4 and 24 |
| A third of laundering groups recovered as rings (34%, one seed) | ML_RESULTS.md section 6, rings table, committed setting |
| 130 inputs; 57 account features per endpoint | CLAIMS_AUDIT.md row 49 (read from the model files) |
| Trained on the VM in 15 to 32 minutes (882 s IBM-only bundle, 31 min 46 s demo bundle) | ML_RESULTS.md sections 4 and 7 |
| New payment shows in about 10 s when idle (9.6 to 9.9 s) | PLATFORM_RESULTS.md section 3c |
| Assistant: IBM Granite Embedding on the VM picks the topic (87% on 31 fresh questions), answers come from our API | CHATBOT.md |
| No accelerator for detection | TECHNICAL_DESIGN.md, "What we do not claim" |
