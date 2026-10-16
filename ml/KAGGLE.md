# Running jobs on Kaggle

Heavy training and evaluation runs on a Kaggle **CPU** notebook, not on a laptop.

## Why CPU, and how the free quota works

- The weekly limit (about 30 hours) is for **GPU** sessions. A CPU session does not use it. Check the current limits on Kaggle, since free tiers change.
- A CPU notebook has more memory (about 30 GB) than a GPU one (about 13 GB), and our XGBoost jobs do not need a GPU.
- Save GPU hours for a GraphSAGE comparison, if we build one. Do not turn the accelerator on for the jobs in `kaggle_run.py`.

## How to run

1. Edit `JOBS` in `ml/kaggle_run.py` to the jobs you want. Each run starts from scratch, so batch jobs into one run.
2. Package the code as a private dataset (`edithstark/nexusz-code`) containing `ml/`, `data/` and `api/` from the committed branch.
3. Push the notebook: a script notebook with `enable_gpu: false`, `enable_internet: false`, and two inputs, the IBM AML dataset and `nexusz-code`.
4. Download the results with `kaggle kernels output`. Logs, `models/`, `exports/` and `summary.txt` come back.

The runner runs the unit tests first and stops if they fail, so a broken commit costs seconds, not a full run.

## Before spending a run

- Commit and push the code you want to run, and rebuild the code dataset from that commit.
- Never put data or credentials in the code dataset.
- Do not turn on a GPU or internet unless the job needs it.
