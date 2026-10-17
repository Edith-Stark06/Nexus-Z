from ml.ring_ids import stable_ids
from ml.service import Scorer
from ml.features import build_features


def fs(*a):
    return frozenset(a)


def test_a_ring_that_gains_members_keeps_its_id():
    out = stable_ids({"H1": fs("a", "b", "c", "d", "e")}, {"RNG-OLD": fs("a", "b", "c")})
    assert out == {"H1": "RNG-OLD"}


def test_a_ring_that_loses_a_member_keeps_its_id():
    assert stable_ids({"H1": fs("a", "b", "c")}, {"RNG-OLD": fs("a", "b", "c", "d")}) == {"H1": "RNG-OLD"}


def test_unrelated_rings_get_their_own_hash_ids():
    out = stable_ids({"H1": fs("x", "y", "z")}, {"RNG-OLD": fs("a", "b", "c")})
    assert out == {"H1": "H1"}


def test_one_shared_account_is_not_enough():
    assert stable_ids({"H1": fs("a", "x", "y")}, {"RNG-OLD": fs("a", "b", "c")}) == {"H1": "H1"}


def test_a_split_keeps_the_id_on_the_better_match_only():
    out = stable_ids({"H1": fs("a", "b", "c", "d", "e"), "H2": fs("f", "g", "h")}, {"RNG-OLD": fs("a", "b", "c", "d", "e", "f", "g", "h")})
    assert out["H1"] == "RNG-OLD" and out["H2"] == "H2"      # an id is never served for two rings


def test_a_merge_keeps_the_id_of_the_larger_overlap():
    out = stable_ids({"H1": fs("a", "b", "c", "d", "e", "f")}, {"RNG-1": fs("a", "b", "c", "d"), "RNG-2": fs("e", "f", "g")})
    assert out == {"H1": "RNG-1"}


def test_the_result_does_not_depend_on_dict_order():
    new = {"H1": fs("a", "b", "c"), "H2": fs("c", "d", "e")}
    prev = {"P1": fs("a", "b", "c", "d"), "P2": fs("c", "d", "e", "f")}
    assert stable_ids(new, prev) == stable_ids(dict(reversed(list(new.items()))), dict(reversed(list(prev.items()))))


def test_with_no_previous_rings_the_hash_ids_are_used():
    assert stable_ids({"H1": fs("a", "b", "c")}, {}) == {"H1": "H1"}


def test_a_hash_id_never_collides_with_an_id_in_use():
    out = stable_ids({"H1": fs("a", "b", "c"), "H2": fs("x", "y", "z")}, {"H2": fs("a", "b", "c")})
    assert len(set(out.values())) == 2


def test_the_scorer_serves_the_old_id_when_its_ring_changed(tx_and_bundle):
    tx, bundle = tx_and_bundle
    feats = build_features(tx, bundle.ccy_median)
    first = Scorer(bundle, feats, tx, tx["ts"].max())
    rid, members = next((r, m) for r, m in first.ring_members().items() if len(m) >= 3)
    smaller = fs(*sorted(members)[:-1]) if len(members) > 3 else members
    again = Scorer(bundle, feats, tx, tx["ts"].max(), previous_rings={"RNG-KEEP00": smaller})
    assert "RNG-KEEP00" in again.ring_members() and rid not in again.ring_members()   # same ring, old id
    assert again.get_ring("RNG-KEEP00")["ring_id"] == "RNG-KEEP00"
    assert any(m["id"] in members for m in again.get_ring("RNG-KEEP00")["members"])
