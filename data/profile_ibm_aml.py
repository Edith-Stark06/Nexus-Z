"""Print a profile of an IBM AML variant: size, time range, label rates, degrees, currencies.

Usage (from the repo root):  python -m data.profile_ibm_aml HI-Small
"""
import sys

import pandas as pd

from .ibm_aml import account_labels, load_transactions, primary_period, time_split


def main(variant: str) -> None:
    tx = load_transactions(variant)
    n, bad = len(tx), int(tx["is_laundering"].sum())
    print(f"== {variant}: {n:,} transactions, {bad:,} laundering (1 in {n // max(bad, 1):,})")
    print(f"time range: {tx['ts'].min()} to {tx['ts'].max()}")

    daily = tx.groupby(tx["ts"].dt.date).agg(tx=("tx_id", "size"), laundering=("is_laundering", "sum"))
    print("\n-- per day --")
    print(daily.to_string())

    accounts = account_labels(tx)
    print(f"\naccounts: {len(accounts):,}, touched by laundering: {int(accounts.sum()):,} "
          f"({accounts.mean():.3%})")

    self_tx = tx["src"] == tx["dst"]
    print(f"\nself-transfers: {self_tx.mean():.2%} of rows, laundering among them: "
          f"{int(tx.loc[self_tx, 'is_laundering'].sum())}")

    print("\n-- by payment format (rows, laundering, rate) --")
    by_fmt = tx.groupby("channel", observed=True)["is_laundering"].agg(["size", "sum", "mean"])
    print(by_fmt.sort_values("size", ascending=False).to_string())

    print("\n-- currencies (payment), top 8 --")
    print(tx["currency"].value_counts().head(8).to_string())
    cross = (tx["currency"].astype(str) != tx["receiving_currency"].astype(str)).mean()
    print(f"payment currency differs from receiving currency: {cross:.2%}")

    out_deg = tx.groupby("src").size()
    in_deg = tx.groupby("dst").size()
    print("\n-- degree --")
    print(pd.DataFrame({"out": out_deg.describe(), "in": in_deg.describe()}).round(2).to_string())
    print(f"max out-degree {out_deg.max():,}, max in-degree {in_deg.max():,}")

    tail = tx.loc[~tx.index.isin(primary_period(tx, variant).index)]
    print(f"\nrows after the stated date range: {len(tail):,}, laundering among them: "
          f"{int(tail['is_laundering'].sum()):,} ({tail['is_laundering'].mean():.0%})")

    for name, frame in [("all rows", tx), ("primary period only", primary_period(tx, variant))]:
        split = time_split(frame)
        print(f"\n-- 60/20/20 time split, {name} --")
        g = frame.groupby(split)
        summary = pd.DataFrame({
            "rows": g.size(), "laundering": g["is_laundering"].sum(),
            "from": g["ts"].min(), "to": g["ts"].max(),
        })
        summary["rate"] = summary["laundering"] / summary["rows"]
        print(summary.loc[["train", "val", "test"]].to_string())

    first_seen = pd.concat([tx[["src", "ts"]].rename(columns={"src": "acc"}),
                            tx[["dst", "ts"]].rename(columns={"dst": "acc"})]).groupby("acc")["ts"].min()
    day0 = tx["ts"].min().normalize()
    new_share = (first_seen < day0 + pd.Timedelta(days=1)).mean()
    print(f"\naccounts first seen on day 1 of the window: {new_share:.1%} "
          f"(no account open date exists in this dataset)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
