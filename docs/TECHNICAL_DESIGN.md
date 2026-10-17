# Technical design and use of LinuxONE

NEXUS Z finds coordinated fraud rings in a stream of payments, explains each flag, and warns the next likely victim. This page is the evidence for how it is built and how it uses the LinuxONE platform. Every number comes from a run whose command and log are named. Results and their limits are in [ML_RESULTS.md](ML_RESULTS.md).

## 1. How the system is put together

| Piece | What it does | Where it runs |
|---|---|---|
| Features (`ml/features.py`) | 57 account features from the payments seen so far: transaction, timing, graph, structure, burst and motif | LinuxONE VM |
| Payment model (`ml/edge_model.py`) | Scores every payment from its own features, the money flow around it and both endpoints | Trained and served on the VM |
| Rings (`ml/rings.py`) | Links high-risk accounts by their payments, grows rings through weaker linked accounts, splits large groups with Louvain | VM |
| Explanations (`ml/explain.py`) | Exact TreeSHAP contributions, computed by XGBoost, with readable labels | VM |
| Scoring service (`ml/service.py`, `ml/api_backend.py`) | `score_account`, `get_ring`, `explain`, alerts; plugs into the API's backend interface | VM |
| API (`api/`) and dashboard (`dashboard/`) | Serve rings, accounts and alerts; show the flow graph, the reasons and the warning | Being deployed on the VM by the platform and dashboard workstreams (not part of the measurements below) |

No payment is judged alone. A single payment is scored, but its features include what the sender received just before and what the receiver did next, so the signal is the chain of payments, not the payment.

## 2. Why this model (what was tried)

The model was chosen by experiment, on one time split, with the same protocol throughout (features only from payments up to the scoring time; thresholds chosen on validation). Test window, IBM AML HI-Small, PR-AUC of the account ranking:

| Step | PR-AUC | Result |
|---|---|---|
| Account model, transaction features only | 0.110 | baseline |
| + timing and graph features | 0.135 to 0.160 | graph features help, about 20 to 30% |
| + burst and motif features (account model) | 0.149 | **no gain**, not adopted for that model |
| Two-stage (also sees neighbors' scores) | 0.184 | a real gain, 3 seeds |
| **Payment-level model** | **0.428** (3 seeds) | precision 0.74 against 0.30 |
| Payment-level + burst and motif endpoint features (committed) | 0.453 (1 seed) | helps this model |

Two results did not go our way and are kept in the record: graph features added nothing on the Elliptic Bitcoin data, and a learned ring score saturated and was dropped. Details: [ML_RESULTS.md](ML_RESULTS.md).

## 3. How it uses the LinuxONE platform

Platform: the datathon VM, IBM LinuxONE (machine type 9175), RHEL 9.8, s390x (big-endian), 3 vCPUs, 7.5 GB RAM.

| Capability | What we did | Evidence |
|---|---|---|
| **Containerization** | Everything heavy runs in the platform's Jupyter Lab ML container under rootless Podman, with our repo, data and models mounted | `bash ml/linuxone_jupyter.sh`; `podman ps`; [ml/LINUXONE.md](../ml/LINUXONE.md) |
| **Security** | Jupyter bound to the VM's loopback and reached through an SSH tunnel; a random login token in a private file; the platform README's public port and published default token deliberately not used; the default token returns HTTP 403; account ids pseudonymized; public synthetic data only | `ss -ltn` shows `127.0.0.1:38888`; `curl` with the default token returns 403 |
| **Compute** | The whole model is trained on the VM on CPU. The final payment-level folder takes 882 s; XGBoost trains 2.0 to 2.8 times faster on three threads than on one | `python -m ml.bundle HI-Small`; `python -m ml.scaling_check HI-Small` |
| **Scalability** | A full rescore takes 0.28 s for 6 hours of data, 3.2 s for 48 hours (863K payments) and 15.7 s for all 5.1M, at 170,000 to 340,000 payments per second, with 2.7 GB peak memory | `python -m ml.scaling_check HI-Small` |
| **Serving on the VM** | The API (`infra/run_api.sh`) runs the committed payment-level model over 24 h of history (654k payments) on the idle VM: first state 15.3 s, a new payment visible in 12.3 to 12.6 s, idle requests 2 to 3 ms median (18 to 32 ms at p95), 36,900 payments per second accepted into the queue, peak memory 3.3 GB. Under load the oldest served state was 36 s | [PLATFORM_RESULTS.md](PLATFORM_RESULTS.md) section 3b; `python -m infra.bench` |
| **Accelerator, measured** | The VM's NNPA counters (`pai_ext`) read while a TensorFlow network, Granite and XGBoost run in the platform container: 5,459 and 36,106 NNPA operations for the network and Granite, 0 for the trees. A capability measurement, not a claim about our detection model | `bash infra/accel_counters.sh`; ML_RESULTS.md section 8 |
| **Correctness on a different architecture** | A model trained on a little-endian laptop gives identical predictions on the big-endian VM (largest difference 9e-16 over 300 rows) | `python -m ml.latency_check check <model> <reference.csv>` |
| **Porting to s390x** | PyPI has no s390x wheels for numpy, pandas, scipy or scikit-learn. We used RHEL's packages for numpy and scipy, built pandas and XGBoost from source, replaced the SHAP package (needs numba and LLVM, not available) with XGBoost's own exact TreeSHAP, and served with the native booster so serving needs no scikit-learn | [ml/README.md](../ml/README.md); `ml/tests/test_explain.py` checks the native values equal the SHAP package's |
| **Platform labs** | All four platform notebooks run end to end on the VM, including the predictive-plus-generative one | [LAB_EVIDENCE.md](LAB_EVIDENCE.md) |
| **Tests on the platform** | The test suite passes inside the platform container | `python -m pytest ml/tests api/tests -q` |

### What we do not claim

- **No on-chip accelerator for our model.** XGBoost, pandas and NetworkX run on ordinary CPU. We did measure the accelerator on this VM with the processor's own counters: a TensorFlow network and IBM Granite through llama.cpp executed thousands of NNPA operations, XGBoost executed none (`bash infra/accel_counters.sh`; [ML_RESULTS.md](ML_RESULTS.md) section 8). A network trained on our payments was worse than the trees (test account PR-AUC 0.39 to 0.13 against 0.54) and a mix gave no gain, so detection stays on trees. We claim no speed-up from the accelerator.
- **Not an incremental update.** Scoring recomputes everything in micro-batches. It is fast on a window of recent data, not per payment.
- **Training did not need a GPU.**

## 4. Open-source software used

XGBoost, scikit-learn (training, from the platform container), pandas, NumPy, SciPy, NetworkX, FastAPI, Pydantic, Uvicorn, pytest, Podman, React, Vite and D3. Full list with links and dataset licenses: [README.md](../README.md).

## 5. Reproduce

```
bash ml/linuxone_jupyter.sh                                  # container on the VM
python -m ml.bundle HI-Small <folder>                        # train the payment-level model folder
python -m ml.edge_eval HI-Small                              # payment model against the account model
python -m ml.ring_grow_eval HI-Small                         # ring growth settings
python -m ml.detection_time HI-Small <folder> 6              # time-to-detection replay
python -m ml.scaling_check HI-Small <folder>                 # window and thread scaling
python -m ml.export_scores HI-Small <folder> <out>           # real model output as API JSON
```

## 6. Limits that matter

- One dataset family (IBM AML) and one time split. The payment model also ranks accounts about three times better than the account model on LI-Small (PR-AUC 0.093 against 0.031, one seed), but there it recovers fewer laundering groups as rings (6.8% against 10.2%, without ring growth); see ML_RESULTS.md. The payment-level numbers are three seeds for the first feature set and one seed for the committed 57-feature model.
- Most laundering groups are still missed: a third recovered as rings, 45% never detected in the replay.
- The injected pig-butchering rings used to test the typology are synthetic and written by our own team, so those results are optimistic. On the more varied generator (`data/rings.py`, 3 seeds) the account models reach PR-AUC about 0.4 and recover 70 to 74% of rings, and most of the gain over transaction-only comes from timing features, not graph features. The committed payment-level model has not been tested on those rings.
- Roles (victim, collector, mule, cash-out) are guessed from position in a ring; the data has no role labels.
