# Trained model and real example output

`HI-Small/` is the model folder made by `python -m ml.bundle HI-Small`. It is what `ml.bundle.load_bundle` and `ml.api_backend.ModelBackend.from_dir` read. **Trained on the LinuxONE VM** (s390x, 3 vCPUs, inside the Jupyter Lab container; see `ml/LINUXONE.md`) on the public synthetic IBM AML HI-Small data (no personal data). It is a **payment-level model**: every payment in the last 24 hours is scored from its own features, the money flow around it and both endpoints' account features (57), and an account takes the score of its riskiest payment. Files: `model_payment.json` (358 trees), `model.json` (the plain account model, 374 trees, a fallback), `meta.json`. About 5 MB. Rings start from the top 0.25% of accounts and grow through linked accounts in the top 2%.

`HI-Small/examples/` holds real model output for the HI-Small test window, in the exact shapes of `api/schemas.py` (each file was validated against the schemas when written): `rings.json`, `alerts.json`, one account, and four rings including the largest (`ring_RNG-950DF2.json`, 24 accounts, a good one for a graph view). Regenerate with `python -m ml.export_scores HI-Small`.

Read before using the output (details in docs/ML_RESULTS.md):

- Ring `risk` is the mean calibrated laundering probability of the ring's three most suspicious accounts, times 100. It is a priority, not the probability that the ring is real. A learned ring score was tried and dropped because it saturated (see `docs/ML_RESULTS.md`).
- Roles (victim, collector, mule, cash-out) are guessed from position inside a ring. The IBM data has no role labels.
- `total_amount` and edge amounts mix currencies. Do not show them as dollars.
- Ring ids are a hash of the member list, so a ring that gains a member gets a new id.
