"""Write the last N hours of a variant's primary period as a raw IBM-format CSV.

Usage (from the repo root):  python -m ml.make_slice HI-Small 48 HI-Slice

Gives a small file (about 860K transactions for 48 hours of HI-Small) for demos, the API and timing
runs, without shipping the 450 MB original. The output is <name>_Trans.csv next to the source.
"""
import sys

import pandas as pd

from data.ibm_aml import PRIMARY_DAYS
from data.paths import IBM_AML_DIR


def make_slice(variant: str, hours: int, name: str) -> int:
    src = IBM_AML_DIR / f"{variant}_Trans.csv"
    ts = pd.to_datetime(pd.read_csv(src, usecols=[0], names=["ts"], header=0, dtype="str")["ts"], format="%Y/%m/%d %H:%M")
    end = ts.min().normalize() + pd.Timedelta(days=PRIMARY_DAYS[variant.split("-")[1]])
    keep = ((ts >= end - pd.Timedelta(hours=hours)) & (ts < end)).to_numpy()
    rows = 0
    with open(src, encoding="utf-8") as f, open(IBM_AML_DIR / f"{name}_Trans.csv", "w", encoding="utf-8", newline="") as g:
        g.write(f.readline())
        for wanted, line in zip(keep, f):
            if wanted:
                g.write(line)
                rows += 1
    return rows


if __name__ == "__main__":
    variant, hours, name = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    print(f"wrote {make_slice(variant, hours, name):,} rows to {IBM_AML_DIR / (name + '_Trans.csv')}")
