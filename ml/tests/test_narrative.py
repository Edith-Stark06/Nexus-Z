import pytest

from ml import narrative
from ml.narrative import Narrator, fact_sheet, prompt_for, template_summary, verify

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


def test_the_template_passes_its_own_check():
    f = fact_sheet(RING, warnings=3)
    assert verify(template_summary(f), f) == (True, "")


@pytest.mark.parametrize("text,why", [
    ("RNG-4A1B2C links 9 accounts through 31 payments.", "numbers not in the facts"),
    ("RNG-4A1B2C links 7 accounts. ACC-00FFEE received the money.", "ids not in the facts"),
    ("RNG-4A1B2C links 7 accounts; its owner is a criminal.", "forbidden"),
    ("RNG-4A1B2C links 7 accounts and nine mules.", "number word"),
    ("", "empty"),
    ("RNG-4A1B2C links 7 accounts", "no complete sentence"),
])
def test_text_that_says_more_than_the_facts_is_rejected(text, why):
    ok, reason = verify(text, fact_sheet(RING, warnings=3))
    assert not ok and why in reason


def test_prompt_shows_two_worked_examples_then_the_new_sheet():
    p = prompt_for(fact_sheet(RING, warnings=3))
    assert p.count("Fact sheet") == 3 and p.rstrip().endswith("Summary:") and "RNG-4A1B2C" in p.split("Summary:")[-2]


class FakeLlama:
    def __init__(self, text):
        self.text, self.calls = text, 0

    def create_completion(self, prompt, **kw):
        self.calls += 1
        return {"choices": [{"text": self.text}]}


def narrator_with(text, tmp_path):
    n = Narrator(str(tmp_path / "model.gguf"))
    (tmp_path / "model.gguf").write_bytes(b"x")
    n._llm = FakeLlama(text)
    n.available = lambda: True
    return n


def test_a_verified_model_text_is_used_and_cached(tmp_path):
    f = fact_sheet(RING, warnings=3)
    n = narrator_with(" RNG-4A1B2C links 7 accounts through 31 payments, mainly because money leaves within minutes. 3 payers may be at risk.\n\nFact sheet", tmp_path)
    out = n.summarize(f)
    assert out["source"] == narrative.MODEL_LABEL and out["verified"] and out["summary"].startswith("RNG-4A1B2C links 7")
    n.summarize(f)
    assert n._llm.calls == 1                      # the second request is served from the cache


def test_an_invented_number_falls_back_to_the_template(tmp_path):
    f = fact_sheet(RING, warnings=3)
    out = narrator_with("RNG-4A1B2C links 70 accounts through 31 payments.", tmp_path).summarize(f)
    assert out["source"] == "template" and out["summary"] == template_summary(f) and "failed the facts check" in out["note"]


def test_a_missing_model_gives_the_template(tmp_path):
    f = fact_sheet(RING)
    out = Narrator(str(tmp_path / "nothing.gguf")).summarize(f)
    assert out["source"] == "template" and "not found" in out["note"] and out["summary"] == template_summary(f)


def test_a_crashing_model_does_not_break_the_page(tmp_path):
    n = narrator_with("", tmp_path)
    n._llm.create_completion = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    out = n.summarize(fact_sheet(RING))
    assert out["source"] == "template" and "failed" in out["note"]
