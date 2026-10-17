import pytest

from ml import narrative
from ml.narrative import Narrator, fact_sheet, prompt_for, template_summary, verify_explanation

RING = {"ring_id": "RNG-4A1B2C", "risk": 97, "accounts": 7,
        "members": [{"id": f"A{i}", "role": r, "score": 0.9} for i, r in
                    enumerate(["victim", "collector", "collector", "mule", "mule", "cashout", "victim"])],
        "edges": [{"src": "A0", "dst": "A1", "amount": 1.0, "ts": "2022-09-09T10:00:00Z"}] * 31,
        "top_reasons": [{"feature": "d_self_share", "label": "Receiver: many transfers to itself (absent)", "contribution": 1.4},
                        {"feature": "s_pt_median", "label": "Sender: money leaves within minutes", "contribution": 0.5}]}


def test_facts_come_from_the_ring_and_skip_absent_signals():
    f = fact_sheet(RING, warnings=3)
    assert (f["accounts"], f["payments"], f["victims"], f["collectors"], f["mules"], f["cashouts"], f["warnings"]) == (7, 31, 2, 2, 2, 1, 3)
    assert f["signal"] == "money leaves within minutes"      # the absent signal is not presented as a signal
    assert fact_sheet({**RING, "top_reasons": []})["signal"] == "an unusual payment pattern"


def test_the_template_states_every_fact_exactly():
    t = template_summary(fact_sheet(RING, warnings=3))
    for part in ("RNG-4A1B2C", "7 accounts", "31 payments", "97 of 100", "2 likely victims", "2 collectors", "2 mules",
                 "1 cash-outs", "3 recent payers", "money leaves within minutes"):
        assert part in t
    assert t.endswith("roles are estimates.")


@pytest.mark.parametrize("text,why", [
    ("Funds moved on within minutes can mean the accounts only pass money along.", ""),
    ("Two likely victims pay a collector.", "number"),
    ("Funds moved on within 5 minutes can mean the accounts only pass money along.", "number"),
    ("The money went to ACC-00FFEE, an account that only passes money along.", "id"),
    ("The owner of this account is a criminal who only passes money along.", "forbidden"),
    ("We think this means that the accounts only pass money along.", "person"),
    ("Funds moved on quickly. They only pass money along as a rule.", "one complete sentence"),
    ("Too short.", "short"),
    ("Funds moved on quickly can mean the accounts only pass money along", "one complete sentence"),
])
def test_only_a_clean_sentence_without_numbers_or_ids_is_accepted(text, why):
    ok, reason = verify_explanation(text)
    assert ok == (why == "") and why in reason


def test_prompt_shows_three_worked_examples_then_the_new_signal():
    p = prompt_for("it is active across many hours")
    assert p.count("Signal:") == 4 and p.rstrip().endswith("Meaning:") and p.split("Signal:")[-1].startswith(" it is active")


class FakeLlama:
    def __init__(self, text):
        self.text, self.calls = text, 0

    def create_completion(self, prompt, **kw):
        self.calls += 1
        return {"choices": [{"text": self.text}]}


def narrator_with(text, tmp_path):
    n = Narrator(str(tmp_path / "model.gguf"))
    n._llm = FakeLlama(text)
    n.available = lambda: True
    return n


GOOD = " Funds that are moved on within minutes can mean the accounts are only passing money along.\nSignal: next"


def test_a_clean_model_sentence_is_added_after_the_exact_facts_and_cached(tmp_path):
    f = fact_sheet(RING, warnings=3)
    n = narrator_with(GOOD, tmp_path)
    out = n.summarize(f)
    assert out["explanation"].startswith("Funds that are moved on") and "Granite" in out["source"]
    assert out["summary"].startswith(narrative.facts_sentence(f)) and out["summary"].endswith("roles are estimates.")
    n.summarize(f)
    assert n._llm.calls == 1                      # the second request is served from the cache


def test_a_sentence_with_a_number_is_dropped_and_the_template_alone_is_shown(tmp_path):
    f = fact_sheet(RING, warnings=3)
    out = narrator_with("Two likely victims pay a collector.", tmp_path).summarize(f)
    assert out["source"] == "template" and out["summary"] == template_summary(f) and "failed the check" in out["note"]


def test_a_missing_model_gives_the_template(tmp_path):
    f = fact_sheet(RING)
    out = Narrator(str(tmp_path / "nothing.gguf")).summarize(f)
    assert out["source"] == "template" and "not found" in out["note"] and out["summary"] == template_summary(f)


def test_a_crashing_model_does_not_break_the_page(tmp_path):
    n = narrator_with("", tmp_path)

    def boom(*a, **k):
        raise RuntimeError("boom")

    n._llm.create_completion = boom
    out = n.summarize(fact_sheet(RING))
    assert out["source"] == "template" and "failed" in out["note"]
