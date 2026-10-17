"""Transaction-level model: score each payment, then give an account the score of its riskiest payment.

The IBM data labels individual transactions. An account-level label ("touched laundering at any point")
is blurry, because laundering accounts also make ordinary payments. Here every payment gets features of the
payment itself (amount, channel, hour, currency change), of the money flow around it (how soon the sender
received money before sending, how soon the receiver passes it on) and of both endpoints (the account
features). The account score is the highest payment score in the window.

As everywhere else, features only use transactions up to the snapshot cutoff (see PROTOCOL.md).
"""
import numpy as np
import pandas as pd

from .features import CHANNELS

TX_FEATURES = (["amount_norm", "log_amount", "cross_ccy", "hour", "self_transfer",
                "prev_in_gap", "prev_in_ratio", "next_out_gap", "next_out_ratio"]
               + [f"ch_{c}" for c in CHANNELS])


def flow_features(window: pd.DataFrame, hist: pd.DataFrame, index: pd.Index, ccy_median: dict) -> pd.DataFrame:
    """Per-payment features for the rows of `window`. `hist` holds every transaction up to the cutoff.

    prev_in_gap / prev_in_ratio: minutes since the sender last received money (before this payment) and this
        payment's amount over that inbound amount. Small gap and ratio near 1 mean money passed straight through.
    next_out_gap / next_out_ratio: minutes until the receiver next sends money, and that outflow over this amount.
    """
    if len(window) < 50_000:  # a few payments need only the history of their own senders and receivers
        hist = hist[hist["dst"].isin(window["src"]) | hist["src"].isin(window["dst"])]

    def codes(frame, col):
        return index.get_indexer(frame[col]).astype(np.int64)

    def norm(frame):
        return frame["amount"].to_numpy() / frame["currency"].astype(str).map(ccy_median).fillna(1.0).to_numpy()

    w = pd.DataFrame({"ts": window["ts"].to_numpy(), "src": codes(window, "src"), "dst": codes(window, "dst"),
                      "amt": norm(window), "row": np.arange(len(window))}).sort_values("ts", kind="stable")
    h_amt = norm(hist)
    inbound = pd.DataFrame({"ts": hist["ts"].to_numpy(), "acct": codes(hist, "dst"), "amt": h_amt, "ts2": hist["ts"].to_numpy()})
    outbound = pd.DataFrame({"ts": hist["ts"].to_numpy(), "acct": codes(hist, "src"), "amt": h_amt, "ts2": hist["ts"].to_numpy()})
    inbound, outbound = inbound.sort_values("ts", kind="stable"), outbound.sort_values("ts", kind="stable")

    prev = pd.merge_asof(w.rename(columns={"src": "acct"}), inbound, on="ts", by="acct", direction="backward",
                         allow_exact_matches=False, suffixes=("", "_in"))
    nxt = pd.merge_asof(w.rename(columns={"dst": "acct"}), outbound, on="ts", by="acct", direction="forward",
                        allow_exact_matches=False, suffixes=("", "_out"))
    out = pd.DataFrame(index=w["row"].to_numpy())
    out["prev_in_gap"] = ((prev["ts"] - prev["ts2"]).dt.total_seconds() / 60).to_numpy()
    out["prev_in_ratio"] = (prev["amt"] / prev["amt_in"]).to_numpy()
    out["next_out_gap"] = ((nxt["ts2"] - nxt["ts"]).dt.total_seconds() / 60).to_numpy()
    out["next_out_ratio"] = (nxt["amt_out"] / nxt["amt"]).to_numpy()
    return out.sort_index().reset_index(drop=True)


def payment_features(window: pd.DataFrame, hist: pd.DataFrame, all_X: pd.DataFrame, cols: list[str],
                     ccy_median: dict) -> pd.DataFrame:
    """One row per payment in `window`: payment features, flow features, and both endpoints' account features."""
    amt = window["amount"].to_numpy() / window["currency"].astype(str).map(ccy_median).fillna(1.0).to_numpy()
    base = pd.DataFrame({
        "amount_norm": amt, "log_amount": np.log1p(amt),
        "cross_ccy": (window["currency"].astype(str).to_numpy() != window["receiving_currency"].astype(str).to_numpy()).astype(float),
        "hour": window["ts"].dt.hour.to_numpy().astype(float),
        "self_transfer": (window["src"].to_numpy() == window["dst"].to_numpy()).astype(float),
    })
    channel = window["channel"].astype(str).to_numpy()
    for c in CHANNELS:
        base[f"ch_{c}"] = (channel == c).astype(float)
    flow = flow_features(window, hist, all_X.index, ccy_median)
    src_x = all_X[cols].iloc[all_X.index.get_indexer(window["src"])].add_prefix("s_").reset_index(drop=True)
    dst_x = all_X[cols].iloc[all_X.index.get_indexer(window["dst"])].add_prefix("d_").reset_index(drop=True)
    rows = pd.concat([base.reset_index(drop=True), flow, src_x, dst_x], axis=1).astype("float32")
    return rows


def payment_probabilities(model, calibration, window, hist, all_X, cols, ccy_median) -> np.ndarray:
    """Calibrated laundering probability of every payment in `window`. `model` is a Booster or a classifier."""
    import xgboost as xgb

    from .model import calibrated

    rows = payment_features(window, hist, all_X, cols, ccy_median)
    booster = model.get_booster() if hasattr(model, "get_booster") else model
    return calibrated(booster.predict(xgb.DMatrix(rows), output_margin=True), calibration)


def payment_frames(tx, split, snaps, cols, ccy_median, keep_rate: float = 0.05, seed: int = 0):
    """The rows the payment models learn from: (X, y) for training and for validation.

    Training keeps every laundering payment and a random `keep_rate` share of the rest, since only about
    1 payment in 1,300 is laundering. Validation (early stopping and calibration) uses every payment.
    """
    cut = {k: tx.loc[split == k, "ts"].max() for k in ("train", "val")}
    train_w, val_w = tx[split == "train"], tx[split == "val"].reset_index(drop=True)
    rng = np.random.default_rng(seed)
    sample = train_w[(train_w["is_laundering"] == 1) | (rng.random(len(train_w)) < keep_rate)].reset_index(drop=True)
    X_tr = payment_features(sample, tx[tx["ts"] <= cut["train"]], snaps["train"].all_X, cols, ccy_median)
    X_va = payment_features(val_w, tx[tx["ts"] <= cut["val"]], snaps["val"].all_X, cols, ccy_median)
    return (X_tr, sample["is_laundering"].to_numpy()), (X_va, val_w["is_laundering"].to_numpy())


def fit_payment_model(tx, split, snaps, cols, ccy_median, keep_rate: float = 0.05, seed: int = 0):
    """Train the payment model. Returns (classifier, Platt calibration, validation payment probabilities)."""
    from xgboost import XGBClassifier

    from .model import calibrated, fit_calibration  # noqa: F401  (fit_calibration shown for symmetry with the account model)

    (X_tr, y_tr), (X_va, y_va) = payment_frames(tx, split, snaps, cols, ccy_median, keep_rate, seed)
    model = XGBClassifier(n_estimators=800, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8,
                          scale_pos_weight=float((y_tr == 0).sum() / max(y_tr.sum(), 1)), eval_metric="aucpr",
                          early_stopping_rounds=40, tree_method="hist", n_jobs=-1, random_state=seed)
    model.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    margin = model.predict(X_va, output_margin=True)
    from sklearn.linear_model import LogisticRegression  # training only

    lr = LogisticRegression(C=1e6, max_iter=1000).fit(margin.reshape(-1, 1), y_va)
    calibration = (float(lr.coef_[0, 0]), float(lr.intercept_[0]))
    return model, calibration, calibrated(margin, calibration)


def account_scores(window: pd.DataFrame, payment_scores: np.ndarray) -> pd.Series:
    """Each account's score is the highest score among the window's payments it sent or received."""
    both = pd.concat([pd.Series(payment_scores, index=window["src"].to_numpy()),
                      pd.Series(payment_scores, index=window["dst"].to_numpy())])
    return both.groupby(level=0).max().rename("risk")
