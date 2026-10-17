import re

import pytest

from ml.narrative import MEANINGS, case_summary, clean_reason, meaning_for

RING = {"ring_id": "RNG-4A1B2C", "risk": 97, "accounts": 7,
        "members": [{"id": f"A{i}", "role": r, "score": 0.9} for i, r in
                    enumerate(["victim", "collector", "collector", "mule", "mule", "cashout", "victim"])],
        "edges": [{"src": "A0", "dst": "A1", "amount": 1.0, "ts": "2022-09-09T10:00:00Z"}] * 31,
        "top_reasons": [{"feature": "d_self_share", "label": "Receiver: many transfers to itself (absent)", "contribution": 1.4},
                        {"feature": "s_pt_median", "label": "Sender: money leaves within minutes", "contribution": 0.5}]}


def test_summary_states_the_ring_facts_and_leads_with_a_signal_that_is_really_present():
    text = case_summary(RING)
    for part in ("RNG-4A1B2C", "7 accounts", "31 payments", "97 of 100", "main signal is that money leaves within minutes",
                 "2 likely victims", "2 collectors", "2 mules", "1 cash-outs"):
        assert part in text
    assert "transfers to itself" not in text            # the absent signal is not presented as a signal
    assert text.endswith("Verify the accounts before any action; roles are estimates.")


def test_the_payment_count_can_be_given_when_only_the_newest_edges_are_attached():
    assert "600 payments" in case_summary(RING, payments=600) and "31 payments" not in case_summary(RING, payments=600)


def test_without_a_present_signal_or_a_known_meaning_the_summary_still_reads_cleanly():
    bare = {**RING, "top_reasons": [{"feature": "d_x", "label": "Receiver: x (absent)", "contribution": 0.4}]}
    text = case_summary(bare)
    assert "main signal" not in text and text.startswith("Ring RNG-4A1B2C links 7 accounts")
    unknown = {**RING, "top_reasons": [{"feature": "mystery", "label": "Mystery feature", "contribution": 0.4}]}
    assert "main signal is that mystery feature." in case_summary(unknown) and meaning_for("mystery") is None


@pytest.mark.parametrize("feature,expected", [
    ("s_pt_median", "passed on within minutes"), ("d_reciprocity", "back and forth"), ("s_dup_amount_share", "Repeated amounts"),
    ("d_fanin_6h", "victims paying into collection"), ("ch_ACH", "payment channels"), ("d_kcore", "interlinked"),
    ("prev_in_gap", "passed on within minutes"), ("cross_ccy", "currency"), ("s_nb_in_max", "around it also look risky"),
])
def test_meanings_are_matched_by_feature_ignoring_the_sender_or_receiver_prefix(feature, expected):
    assert expected in meaning_for(feature)


def test_every_meaning_is_cautious_and_free_of_numbers_and_accusations():
    for pattern, text in MEANINGS:
        assert re.search(r"\b(can|may|is typical|is the shape)\b", text), text      # evidence, not proof
        assert not re.search(r"\d", text) and not re.search(r"criminal|guilty|fraudster|scammer|stolen", text, re.I)
        assert text.endswith(".")


def test_clean_reason_drops_the_prefix_and_the_absent_marker():
    assert clean_reason("Sender: Money leaves within minutes (absent)") == "money leaves within minutes"
