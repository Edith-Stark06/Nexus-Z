# Trained model and real example output

`HI-Small/` is the model folder made by `python -m ml.bundle HI-Small`. It is what `ml.bundle.load_bundle` and `ml.api_backend.ModelBackend.from_dir` read. **Trained on the LinuxONE VM** (s390x, 3 vCPUs, inside the Jupyter Lab container; see `ml/LINUXONE.md`) on the public synthetic IBM AML HI-Small data (no personal data). 48 features, 376 trees, calibrated, with a learned ring scorer. About 2.7 MB.

`HI-Small/examples/` holds real model output for the HI-Small test window, in the exact shapes of `api/schemas.py` (each file was validated against the schemas when written): `rings.json`, `alerts.json`, one account, and four rings including the largest (`ring_RNG-E8308C.json`, 37 accounts, a good one for a graph view). Regenerate with `python -m ml.export_scores HI-Small`.

Read before using the output (details in docs/ML_RESULTS.md):

- Ring `risk` is the learned chance that a ring is mostly laundering accounts. It favors small rings, so the top of the list holds 3-account rings.
- Roles (victim, collector, mule, cash-out) are guessed from position inside a ring. The IBM data has no role labels.
- `total_amount` and edge amounts mix currencies. Do not show them as dollars.
- Ring ids are a hash of the member list, so a ring that gains a member gets a new id.
