"""Loader for the IBM AML synthetic transaction data (HI/LI x Small/Medium).

Output follows the team data contract: tx_id, ts, src, dst, amount, channel, plus the
dataset's own label and currency columns. Account ids are pseudonymized as ACC-XXXXXX.
"""
import numpy as np
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
    return load_with_index(variant, nrows)[0]


def load_with_index(variant: str = "HI-Small", nrows: int | None = None):
    """Like load_transactions, but also return the account keys: key i is the raw "bank:account"
    behind pseudonym ACC-%06X % i. Needed to map other raw files (patterns) onto the same ids."""
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
    codes, keys = pd.factorize(pd.concat([src_key, dst_key], ignore_index=True))
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
    return tx, pd.Index(keys)


def load_patterns(variant: str, keys: pd.Index) -> list[dict]:
    """Parse <variant>_Patterns.txt into one dict per laundering group.

    Each dict has: pattern_id, type (CYCLE, FAN-IN, ...), first_ts, last_ts, n_tx and accounts
    (the set of pseudonymized account ids involved) and events (ts, account id) for both ends of every
    transaction, so a group can be reconstructed as it grew. `keys` comes from load_with_index.
    """
    code_of = pd.Series(np.arange(len(keys)), index=keys)
    blocks, current = [], None
    with open(IBM_AML_DIR / f"{variant}_Patterns.txt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("BEGIN LAUNDERING ATTEMPT"):
                current = {"type": line.split(" - ")[1].split(":")[0].strip(), "rows": []}
            elif line.startswith("END LAUNDERING ATTEMPT"):
                blocks.append(current)
                current = None
            elif current is not None and line:
                current["rows"].append(line.split(","))
    patterns = []
    for i, b in enumerate(blocks):
        rows = b["rows"]
        ts = pd.to_datetime([r[0] for r in rows], format="%Y/%m/%d %H:%M")
        src = code_of.reindex([f"{r[1]}:{r[2]}" for r in rows]).to_numpy()
        dst = code_of.reindex([f"{r[3]}:{r[4]}" for r in rows]).to_numpy()
        events = [(t, "ACC-%06X" % int(c)) for t, s, d in zip(ts, src, dst) for c in (s, d) if not np.isnan(c)]
        patterns.append({"pattern_id": i, "type": b["type"], "first_ts": ts.min(), "last_ts": ts.max(),
                         "n_tx": len(rows), "accounts": {a for _, a in events}, "events": events})
    return patterns


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
