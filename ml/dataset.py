"""Build train/val/test snapshots for an IBM AML variant, following PROTOCOL.md."""
from dataclasses import dataclass

import pandas as pd

from data.ibm_aml import load_transactions, primary_period, time_split
from data.paths import DATA_DIR

from .features import FEATURE_VERSION, build_features

CACHE_DIR = DATA_DIR / "cache"
SPLITS = ("train", "val", "test")


@dataclass
class Snapshot:
    X: pd.DataFrame
    y: pd.Series
    seen_positive: pd.Series  # positive in an earlier window (repeat accounts)
    cutoff: pd.Timestamp


def currency_medians(train_tx: pd.DataFrame) -> dict:
    """Median amount per currency, used to put amounts in different currencies on one scale."""
    med = train_tx.groupby("currency", observed=True)["amount"].median()
    return {str(k): float(v) for k, v in med.items()}


def make_snapshots(variant: str = "HI-Small", use_cache: bool = True) -> dict[str, Snapshot]:
    cache = CACHE_DIR / f"{variant}_snapshots_v{FEATURE_VERSION}.pkl"
    if use_cache and cache.exists():
        return pd.read_pickle(cache)

    tx = primary_period(load_transactions(variant), variant)
    split = time_split(tx)
    ccy_median = currency_medians(tx[split == "train"])

    snapshots, earlier_positive = {}, set()
    for name in SPLITS:
        window = tx[split == name]
        cutoff = window["ts"].max()
        features = build_features(tx[tx["ts"] <= cutoff], ccy_median)

        active = pd.unique(pd.concat([window["src"], window["dst"]], ignore_index=True))
        bad = window[window["is_laundering"] == 1]
        positive = set(bad["src"]) | set(bad["dst"])

        X = features.loc[active]
        snapshots[name] = Snapshot(
            X=X,
            y=pd.Series(X.index.isin(list(positive)).astype("int8"), index=X.index, name="y"),
            seen_positive=pd.Series(X.index.isin(list(earlier_positive)), index=X.index),
            cutoff=cutoff,
        )
        earlier_positive |= positive

    if use_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        pd.to_pickle(snapshots, cache)
    return snapshots
