"""Loader for the IBM AML synthetic transaction data (HI/LI x Small/Medium).

Output follows the team data contract: tx_id, ts, src, dst, amount, channel, plus the
dataset's own label and currency columns. Account ids are pseudonymized as ACC-XXXXXX.
"""
import pandas as pd

from .paths import IBM_AML_DIR

# The raw header has two columns both called "Account", so we read by position.
RAW_COLUMNS = [
    "ts", "from_bank", "from_account", "to_bank", "to_account",
    "amount_received", "receiving_currency", "amount_paid", "payment_currency",
    "payment_format", "is_laundering",
]
CATEGORICAL = ["receiving_currency", "payment_currency", "payment_format"]


def load_transactions(variant: str = "HI-Small", nrows: int | None = None) -> pd.DataFrame:
    """Return transactions sorted by time with pseudonymized src/dst account ids."""
    raw = pd.read_csv(
        IBM_AML_DIR / f"{variant}_Trans.csv",
        header=0,
        names=RAW_COLUMNS,
        dtype={"from_bank": "str", "to_bank": "str", "from_account": "str", "to_account": "str"},
        nrows=nrows,
    )
    raw["ts"] = pd.to_datetime(raw["ts"], format="%Y/%m/%d %H:%M")
    for col in CATEGORICAL:
        raw[col] = raw[col].astype("category")

    # Bank id plus account number identifies an account; factorize both ends together.
    src_key = raw["from_bank"] + ":" + raw["from_account"]
    dst_key = raw["to_bank"] + ":" + raw["to_account"]
    codes, _ = pd.factorize(pd.concat([src_key, dst_key], ignore_index=True))
    n = len(raw)
    pseudo = pd.Index(["ACC-%06X" % c for c in range(codes.max() + 1)])

    tx = pd.DataFrame({
        "ts": raw["ts"],
        "src": pseudo.take(codes[:n]),
        "dst": pseudo.take(codes[n:]),
        "amount": raw["amount_paid"],
        "currency": raw["payment_currency"],
        "channel": raw["payment_format"],
        "amount_received": raw["amount_received"],
        "receiving_currency": raw["receiving_currency"],
        "is_laundering": raw["is_laundering"].astype("int8"),
    })
    tx = tx.sort_values("ts", kind="stable", ignore_index=True)
    tx.insert(0, "tx_id", tx.index.astype("int64"))
    return tx


PRIMARY_DAYS = {"Small": 10, "Medium": 16}


def primary_period(tx: pd.DataFrame, variant: str) -> pd.DataFrame:
    """Drop the thin tail after the dataset's stated date range (10 days Small, 16 Medium).

    In HI-Small the tail is about 1,100 rows of which 59% are laundering, against 0.1% in the
    main period, so leaving it in makes the last time window look far easier than it is.
    """
    days = PRIMARY_DAYS[variant.split("-")[1]]
    end = tx["ts"].min().normalize() + pd.Timedelta(days=days)
    return tx.loc[tx["ts"] < end].reset_index(drop=True)


def account_labels(tx: pd.DataFrame) -> pd.Series:
    """Account-level label: 1 if the account sends or receives any laundering transaction."""
    bad = tx.loc[tx["is_laundering"] == 1]
    flagged = pd.unique(pd.concat([bad["src"], bad["dst"]], ignore_index=True))
    accounts = pd.unique(pd.concat([tx["src"], tx["dst"]], ignore_index=True))
    return pd.Series(pd.Index(accounts).isin(flagged).astype("int8"), index=accounts, name="is_fraud")


def time_split(tx: pd.DataFrame, fractions=(0.6, 0.2, 0.2)) -> pd.Series:
    """Label each transaction train/val/test by time, so later data never trains the model."""
    assert abs(sum(fractions) - 1.0) < 1e-9
    cut_train = tx["ts"].quantile(fractions[0])
    cut_val = tx["ts"].quantile(fractions[0] + fractions[1])
    split = pd.Series("test", index=tx.index, dtype="object")
    split[tx["ts"] <= cut_val] = "val"
    split[tx["ts"] <= cut_train] = "train"
    return split.rename("split")
