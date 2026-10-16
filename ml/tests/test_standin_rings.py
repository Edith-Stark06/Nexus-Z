import numpy as np
import pandas as pd

from ml.standin_rings import HARD_KINDS, RING_KINDS, inject


def background(n=4000, seed=0):
    rng = np.random.default_rng(seed)
    t0 = pd.Timestamp("2022-09-01")
    ids = [f"ACC-{i:06X}" for i in range(500)]
    src, dst = rng.choice(ids, n), rng.choice(ids, n)
    tx = pd.DataFrame({"tx_id": np.arange(n), "ts": t0 + pd.to_timedelta(rng.integers(0, 10 * 24 * 60, n), unit="m"),
                       "src": src, "dst": dst, "amount": rng.lognormal(6, 1, n).round(2)})
    tx["currency"] = tx["receiving_currency"] = "US Dollar"
    tx["channel"] = rng.choice(["ACH", "Cheque", "Credit Card"], n)
    tx["amount_received"] = tx["amount"]
    tx["is_laundering"] = np.int8(0)
    return tx.sort_values("ts", ignore_index=True)


def test_injection_keeps_background_and_labels_only_the_fraud_network():
    tx = background()
    inj = inject(tx, n_rings=8, n_hard=8, seed=1)
    assert len(inj.tx) > len(tx) and inj.tx["ts"].is_monotonic_increasing
    assert inj.tx["ts"].between(tx["ts"].min(), tx["ts"].max()).all()   # nothing outside the dataset's period
    assert set(r["type"] for r in inj.rings) == set(RING_KINDS) and set(h["type"] for h in inj.hard) == set(HARD_KINDS)

    bad = inj.tx[inj.tx["is_laundering"] == 1]
    positives = set(bad["src"]) | set(bad["dst"])
    network = set().union(*[r["accounts"] for r in inj.rings])
    assert positives == network                                          # only collectors, mules and cash-outs
    assert all(a.startswith("ACC-F") for a in network)                    # new accounts, never real ones
    hubs = set().union(*[h["accounts"] for h in inj.hard])
    assert not hubs & positives                                          # legitimate look-alikes are never fraud


def test_victims_are_background_accounts_and_ring_money_moves_on_quickly():
    tx = background()
    inj = inject(tx, n_rings=4, n_hard=4, seed=2)
    new = inj.tx[inj.tx["src"].str.startswith("ACC-F") | inj.tx["dst"].str.startswith("ACC-F")]
    deposits = new[~new["src"].str.startswith("ACC-F")]
    assert (deposits["is_laundering"] == 0).all()                         # a victim payment is not laundering
    fast = [r for r in inj.rings if r["type"] == "fan-in"][0]
    hops = inj.tx[inj.tx["src"].isin(fast["collectors"])]
    first_in = inj.tx[inj.tx["dst"].isin(fast["collectors"])]["ts"].min()
    assert (hops["ts"].min() - first_in) <= pd.Timedelta(minutes=30)      # money leaves within half an hour


def test_same_seed_gives_the_same_rings():
    tx = background()
    a, b = inject(tx, 5, 5, seed=3), inject(tx, 5, 5, seed=3)
    assert a.tx.equals(b.tx) and [r["accounts"] for r in a.rings] == [r["accounts"] for r in b.rings]
