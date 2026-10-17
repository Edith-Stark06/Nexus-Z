"""Write the last N hours of a variant with synthetic pig-butchering rings injected, as a raw IBM-format CSV.

Usage (from the repo root):  python -m ml.make_demo_slice HI-Small 48 HI-Pig-Slice 0

The rings and look-alikes come from data/rings.py with the given seed, the same call that
`python -m ml.bundle HI-Small <folder> payment <seed>` trains on, so this slice is the test end of that data and
the model has not seen its rings. Real accounts keep their raw bank and account number; injected accounts get
bank 9999999 and their own id as the account number. The file loads with the normal loader, so
NEXUSZ_SLICE=HI-Pig-Slice makes the API serve it. Everything injected is synthetic.
"""
import sys

import pandas as pd

from data.ibm_aml import PRIMARY_DAYS, load_with_index, primary_period
from data.paths import IBM_AML_DIR
from data.rings import NEW_ID_BASE, inject

HEADER = ("Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
          "Amount Paid,Payment Currency,Payment Format,Is Laundering\n")
INJECTED_BANK = "9999999"


def raw_account(pseudo: str, keys: pd.Index) -> tuple[str, str]:
    """(bank, account) behind a pseudonym: the original pair for a real account, a made-up one for an injected one."""
    code = int(pseudo[4:], 16)
    if code >= NEW_ID_BASE:
        return INJECTED_BANK, pseudo[4:]
    bank, account = keys[code].split(":", 1)
    return bank, account


def raw_frame(tx: pd.DataFrame, keys: pd.Index) -> pd.DataFrame:
    """Transactions in the loader's column format back into the raw IBM columns."""
    ids = pd.unique(pd.concat([tx["src"], tx["dst"]], ignore_index=True))
    pair = {a: raw_account(a, keys) for a in ids}
    src, dst = tx["src"].map(pair), tx["dst"].map(pair)
    return pd.DataFrame({
        "ts": tx["ts"].dt.strftime("%Y/%m/%d %H:%M"),
        "from_bank": [p[0] for p in src], "from_account": [p[1] for p in src],
        "to_bank": [p[0] for p in dst], "to_account": [p[1] for p in dst],
        "amount_received": tx["amount_received"], "receiving_currency": tx["receiving_currency"].astype(str),
        "amount_paid": tx["amount"], "payment_currency": tx["currency"].astype(str),
        "payment_format": tx["channel"].astype(str), "is_laundering": tx["is_laundering"].astype(int),
    })


def make_demo_slice(variant: str, hours: int, name: str, seed: int) -> tuple[int, int]:
    """Returns (rows written, how many of them touch an injected account)."""
    tx, keys = load_with_index(variant)
    tx = primary_period(tx, variant)
    injected = inject(tx, seed=seed).tx
    end = injected["ts"].min().normalize() + pd.Timedelta(days=PRIMARY_DAYS[variant.split("-")[1]])  # as ml.make_slice
    tail = injected[(injected["ts"] >= end - pd.Timedelta(hours=hours)) & (injected["ts"] < end)]
    raw = raw_frame(tail, keys)
    with open(IBM_AML_DIR / f"{name}_Trans.csv", "w", encoding="utf-8", newline="") as f:
        f.write(HEADER)
        raw.to_csv(f, header=False, index=False)
    is_new = lambda col: tail[col].map(lambda a: int(a[4:], 16) >= NEW_ID_BASE)
    return len(raw), int((is_new("src") | is_new("dst")).sum())


if __name__ == "__main__":
    variant, hours, name, seed = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 0
    rows, touching = make_demo_slice(variant, hours, name, seed)
    print(f"wrote {rows:,} rows ({touching:,} payment ends at injected accounts) to {IBM_AML_DIR / (name + '_Trans.csv')}")
