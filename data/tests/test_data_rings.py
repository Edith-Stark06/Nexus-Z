import numpy as np
import pandas as pd
import pytest

from data.rings import HARD_KINDS, RING_KINDS, inject


def background(n=20000, seed=0, days=10):
    rng = np.random.default_rng(seed)
    t0 = pd.Timestamp("2022-09-01")
    ids = [f"ACC-{i:06X}" for i in range(2000)]
    src, dst = rng.choice(ids, n), rng.choice(ids, n)
    tx = pd.DataFrame({"tx_id": np.arange(n), "ts": t0 + pd.to_timedelta(rng.integers(0, days * 24 * 60, n), unit="m"),
                       "src": src, "dst": dst, "amount": rng.lognormal(6, 1, n).round(2)})
    tx["currency"] = tx["receiving_currency"] = rng.choice(["US Dollar", "Euro", "Yen"], n, p=[0.6, 0.3, 0.1])
    tx["channel"] = rng.choice(["ACH", "Cheque", "Credit Card"], n, p=[0.2, 0.3, 0.5])
    tx["amount_received"] = tx["amount"]
    tx["is_laundering"] = np.int8(0)
    return tx.sort_values("ts", ignore_index=True)[["tx_id", "ts", "src", "dst", "amount", "currency", "channel",
                                                    "amount_received", "receiving_currency", "is_laundering"]]


@pytest.fixture(scope="module")
def inj():
    return inject(background(), n_rings=24, n_hard=20, seed=1)


def test_columns_and_period_match_the_loader(inj):
    tx = background()
    assert list(inj.tx.columns) == list(tx.columns)
    assert len(inj.tx) > len(tx) and inj.tx["ts"].is_monotonic_increasing
    assert inj.tx["ts"].between(tx["ts"].min(), tx["ts"].max()).all()
    assert inj.tx["tx_id"].tolist() == list(range(len(inj.tx)))
    assert (inj.tx["ts"] == inj.tx["ts"].dt.floor("min")).all()


def test_every_shape_and_look_alike_is_present(inj):
    assert {r["type"] for r in inj.rings} == set(RING_KINDS)
    assert {h["type"] for h in inj.hard} == set(HARD_KINDS)
    assert any(h["adversarial"] for h in inj.hard) and any(not h["adversarial"] for h in inj.hard)


def test_only_the_fraud_network_is_labelled_laundering(inj):
    bad = inj.tx[inj.tx["is_laundering"] == 1]
    network = set().union(*[r["accounts"] for r in inj.rings])
    assert set(bad["src"]) | set(bad["dst"]) == network
    assert all(a.startswith("ACC-F") for a in network)
    hubs = set().union(*[h["accounts"] for h in inj.hard])
    assert not hubs & network
    assert all(a.startswith("ACC-F") for a in hubs)


def test_victims_are_background_accounts_and_deposits_are_not_laundering(inj):
    network = set().union(*[r["accounts"] for r in inj.rings])
    for r in inj.rings:
        assert r["victims"] and not set(r["victims"]) & network
        assert not any(v.startswith("ACC-F") for v in r["victims"])
    deposits = inj.tx[inj.tx["dst"].isin({c for r in inj.rings for c in r["collectors"]}) & ~inj.tx["src"].isin(network)]
    assert len(deposits) and (deposits["is_laundering"] == 0).all()


def test_ring_records_agree_with_the_rows(inj):
    bad = inj.tx[inj.tx["is_laundering"] == 1]
    for r in inj.rings:
        mine = bad[bad["src"].isin(r["accounts"]) & bad["dst"].isin(r["accounts"])]
        assert r["n_tx"] == len(mine) == len(r["events"]) // 2
        assert r["first_ts"] == mine["ts"].min() and r["last_ts"] == mine["ts"].max()


def test_timing_is_varied_not_just_fast(inj):
    """Some rings hold money for hours or days; a rule of 'leaves within minutes' cannot catch them all."""
    bad = inj.tx[inj.tx["is_laundering"] == 1]
    holds = {}
    for r in inj.rings:
        first_in = inj.tx[inj.tx["dst"].isin(r["collectors"]) & ~inj.tx["src"].isin(r["accounts"])]["ts"].min()
        holds[r["pattern_id"]] = (r["first_ts"] - first_in).total_seconds() / 60
    kinds = {r["pattern_id"]: r["type"] for r in inj.rings}
    slow = [m for pid, m in holds.items() if kinds[pid] == "delayed"]
    fast = [m for pid, m in holds.items() if kinds[pid] == "fan-in"]
    assert np.median(slow) > 60 and np.median(fast) < 60
    assert len({s for r in inj.rings for s in r["speeds"]}) == 3
    assert len({m for r in inj.rings for m in r["modes"]}) == 3
    assert len(bad)


def test_no_payment_tells(inj):
    """Injected channels and currencies follow the background mix; amounts sit on the background scale."""
    tx = background()
    new = inj.tx[inj.tx["src"].str.startswith("ACC-F") | inj.tx["dst"].str.startswith("ACC-F")]
    a = new["channel"].astype(str).value_counts(normalize=True)
    b = tx["channel"].astype(str).value_counts(normalize=True)
    assert (a.reindex(b.index).fillna(0) - b).abs().max() < 0.05
    # A ring keeps one currency, so currency is checked per ring, not per payment.
    assert {r["currency"] for r in inj.rings} <= set(tx["currency"]) and len({r["currency"] for r in inj.rings}) >= 2
    ratio = new["amount"].median() / tx["amount"].median()
    assert 0.2 < ratio < 5


def test_account_age_is_not_a_fraud_tell(inj):
    """Some fraud rings use accounts with earlier ordinary history; some legitimate accounts are brand new."""
    first = pd.concat([inj.tx.groupby("src")["ts"].min(), inj.tx.groupby("dst")["ts"].min()]).groupby(level=0).min()
    first_laundering = inj.tx[inj.tx["is_laundering"] == 1]
    aged = [r for r in inj.rings if r["aged"]]
    assert aged
    old = [a for r in aged for a in r["accounts"] if first[a] < first_laundering["ts"].min()]
    assert old
    fresh = [h["hub"] for h in inj.hard if not h["aged"]]
    assert fresh and all(first[h] > inj.tx["ts"].min() for h in fresh)


def test_same_seed_gives_the_same_data_and_a_different_seed_does_not():
    tx = background()
    a, b, c = inject(tx, 6, 6, seed=3), inject(tx, 6, 6, seed=3), inject(tx, 6, 6, seed=4)
    assert a.tx.equals(b.tx) and [r["accounts"] for r in a.rings] == [r["accounts"] for r in b.rings]
    assert not a.tx.equals(c.tx)


def test_options_restrict_kinds_and_adversarial_share():
    tx = background()
    inj = inject(tx, 6, 6, seed=5, kinds=["delayed"], hard_kinds=["merchant"], adversarial=0.0)
    assert {r["type"] for r in inj.rings} == {"delayed"} and {h["type"] for h in inj.hard} == {"merchant"}
    assert not any(h["adversarial"] for h in inj.hard)


def test_export_writes_the_contract(tmp_path, inj):
    from data.export import age_leak_check, export

    info = export(inj, tmp_path, seed=1)
    tx = pd.read_csv(tmp_path / "transactions.csv")
    assert list(tx.columns) == ["tx_id", "ts", "src", "dst", "amount", "channel"] and tx["ts"].str.endswith("Z").all()
    acc, lab = pd.read_csv(tmp_path / "accounts.csv"), pd.read_csv(tmp_path / "labels.csv", keep_default_na=False)
    assert list(acc.columns) == ["account_id", "opened_at"] and acc["account_id"].is_unique
    assert list(lab.columns) == ["account_id", "is_fraud", "ring_id", "role", "legit_hub_type"]
    assert set(lab["role"]) <= {"victim", "collector", "mule", "cashout", "none"}
    assert (lab.loc[lab["role"] == "victim", "is_fraud"] == 0).all()
    assert (lab.loc[lab["legit_hub_type"] != "", "is_fraud"] == 0).all()
    assert set(lab.loc[lab["role"] == "collector", "is_fraud"]) == {1}
    assert set(pd.read_csv(tmp_path / "links.csv")["link_type"]) <= {"device", "ip", "beneficiary"}
    assert info["age_leak"]["auc_younger_is_fraud_all"] < 0.8   # age alone must not give the label away
    assert 0.0 <= age_leak_check(inj, 1)["auc_younger_is_fraud_all"] <= 1.0
