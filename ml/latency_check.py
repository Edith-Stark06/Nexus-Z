"""Check the model on another machine (for example the s390x LinuxONE VM) and time scoring there.

  python -m ml.latency_check reference BUNDLE_DIR OUT.csv     write 300 feature rows with this machine's margins
  python -m ml.latency_check check     BUNDLE_DIR REF.csv     recompute the margins here and compare
  python -m ml.latency_check time      BUNDLE_DIR SLICE       time a full rescore of <SLICE>_Trans.csv

`reference` needs the cached snapshots (run it where the data lives). `time` expects a raw IBM-format
CSV named <SLICE>_Trans.csv under the data folder (NEXUSZ_DATA_DIR/ibm-aml), such as the last 48 hours.
Everything printed is measured on the machine running the command.
"""
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .bundle import load_bundle


def reference(bundle_dir: Path, out: Path) -> None:
    from .dataset import make_snapshots

    bundle = load_bundle(bundle_dir)
    X = make_snapshots("HI-Small")["test"].X[bundle.cols].sample(300, random_state=0)
    X.assign(margin=bundle.margin(X)).to_csv(out, float_format="%.17g")
    print(f"wrote {len(X)} rows to {out}")


def check(bundle_dir: Path, ref: Path) -> None:
    bundle = load_bundle(bundle_dir)
    df = pd.read_csv(ref, index_col=0)
    here = bundle.margin(df[bundle.cols])
    diff = np.abs(here - df["margin"].to_numpy())
    print(f"{platform.machine()} ({sys.byteorder}-endian): max margin difference {diff.max():.3g} over {len(df)} rows")
    print("IDENTICAL within 1e-5" if diff.max() < 1e-5 else "MISMATCH")


def timing(bundle_dir: Path, slice_name: str) -> None:
    from data.ibm_aml import load_transactions

    from .features import build_features
    from .service import Scorer

    bundle = load_bundle(bundle_dir)
    t = time.time()
    tx = load_transactions(slice_name)
    print(f"{platform.machine()}, {os.cpu_count()} cpus")
    print(f"loaded {len(tx):,} transactions in {time.time() - t:.1f}s")

    t = time.time()
    feats = build_features(tx, bundle.ccy_median)
    t_feat = time.time() - t
    since = tx["ts"].max() - pd.Timedelta(hours=24)
    recent = tx[tx["ts"] > since]
    X = feats.loc[pd.unique(pd.concat([recent["src"], recent["dst"]], ignore_index=True))]

    t = time.time()
    scorer = Scorer(bundle, X, tx, tx["ts"].max())
    t_score = time.time() - t
    t = time.time()
    summaries = scorer.list_rings()
    t_rings = time.time() - t
    ids = X.index.to_series().sample(min(200, len(X)), random_state=0).tolist()
    t = time.time()
    for a in ids:
        scorer.score_account(a)
    per_account_ms = (time.time() - t) / len(ids) * 1000

    print(f"features for {len(feats):,} accounts: {t_feat:.1f}s")
    print(f"score {len(X):,} accounts and form {len(scorer.rings)} rings: {t_score:.1f}s")
    print(f"describe and explain all rings (once, then cached): {t_rings:.1f}s")
    print(f"score_account incl. explanation: {per_account_ms:.1f} ms each (mean over {len(ids)} accounts)")
    print(f"full rescore (features + scores + rings): {t_feat + t_score:.1f}s")
    try:
        import resource  # Unix only

        print(f"peak memory: {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB")
    except ImportError:
        pass


if __name__ == "__main__":
    mode, bundle_dir, arg = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    {"reference": reference, "check": check, "time": timing}[mode](bundle_dir, Path(arg) if mode != "time" else arg)
