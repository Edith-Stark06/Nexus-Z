"""Granite Embedding picks the topic; the sentences stay fixed. Tested with a scripted router (no model, no torch) and, when the model is there, for real."""
import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from api.backend import get_backend
from api.chat import HELP, ChatConfig, ChatRequest, ChatService, keyword_topic, rules_answer, Tools
from api.intent import EXAMPLES, IntentRouter
from api.intent_eval import DEVELOPMENT, FRESH, HELD_OUT
from api.main import app, get_chat
from api.stub_backend import StubBackend

RING = "RNG-0417"


class ScriptedRouter(IntentRouter):
    """Stands in for the model: returns a fixed topic and counts the questions it was asked."""

    def __init__(self, topic="top_rings", score=0.9, fails=None):
        super().__init__("ibm-granite/granite-embedding-30m-english")
        self.topic, self.score, self.asked = topic, score, []
        self._failed = fails
        self._ready = fails is None

    def route(self, question):
        self.asked.append(question)
        return self.topic, self.score


def svc(router, **kw):
    return ChatService(ChatConfig(token_file="/nonexistent/token", intent_model="x", **kw), router=router)


def ask(service, text):
    return service.ask(ChatRequest(message=text), StubBackend())


@pytest.fixture(autouse=True)
def no_token(monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)


# -- the local path
def test_without_a_token_granite_embedding_picks_the_topic_and_the_answer_comes_from_the_api():
    r = ScriptedRouter("alerts", 0.81)
    out = ask(svc(r), "anything the system raised overnight?")
    assert out.mode == "local" and out.model == "ibm-granite/granite-embedding-30m-english" and out.provider == "this machine"
    assert "Newest alerts" in out.answer and [t.tool for t in out.tools_used] == ["list_alerts"]
    assert "alerts" in out.note and "0.81" in out.note and "fixed" in out.note
    assert r.asked == ["anything the system raised overnight?"]


@pytest.mark.parametrize("topic,expected", [("top_rings", "Highest-risk rings"), ("explain_top", RING), ("victims", "likely victims flagged"),
                                            ("alerts", "Newest alerts"), ("status", "Backend: stub")])
def test_every_topic_has_an_answer(topic, expected):
    out = ask(svc(ScriptedRouter(topic)), "whatever")
    assert out.mode == "local" and expected.lower() in out.answer.lower()


def test_when_nothing_is_close_enough_the_help_text_is_shown_and_keywords_do_not_overrule_the_model():
    out = ask(svc(ScriptedRouter(None, 0.42)), "write me a poem about rings")        # the keyword rules would have listed the rings
    assert out.mode == "local" and out.answer == HELP and out.tools_used == [] and "no topic close enough" in out.note


def test_a_question_that_names_an_id_does_not_need_the_model():
    r = ScriptedRouter("alerts")
    out = ask(svc(r), f"Explain {RING}")
    assert out.mode == "local" and RING in out.answer and r.asked == [] and "no topic was needed" in out.note


def test_the_model_cannot_add_facts_only_choose_among_the_fixed_answers():
    r = ScriptedRouter("explain_top")
    out = ask(svc(r), "anything")
    assert out.answer == rules_answer("Why was the top ring flagged?", Tools(StubBackend()), [])


# -- when the model cannot be used
def test_a_model_that_cannot_load_means_keywords_and_the_note_says_why():
    out = ask(svc(ScriptedRouter(fails="OSError: no such folder")), "Which rings are riskiest?")
    assert out.mode == "rules" and "Highest-risk rings" in out.answer and "could not be loaded" in out.note and "no such folder" in out.note


def test_a_missing_folder_is_reported_not_raised(tmp_path):
    router = IntentRouter(str(tmp_path / "missing"))
    assert router.available() is False and router.failure and router.route("which rings are riskiest") == (None, 0.0)
    assert ask(svc(router), "Which rings are riskiest?").mode == "rules"


def test_switching_the_assistant_off_switches_the_model_off_too():
    s = ChatService(ChatConfig(token_file="/nonexistent/token", intent_model="x", enabled=False))
    assert s.router is None and ask(s, "Which rings are riskiest?").mode == "rules"


def test_no_intent_model_configured_means_no_router_and_the_old_behaviour():
    s = ChatService(ChatConfig(token_file="/nonexistent/token"))
    assert s.router is None and s.status().mode == "rules" and s.status().intent_model is None


# -- the hosted model comes first when there is a token
def test_a_working_hosted_model_is_used_before_the_local_one(tmp_path):
    token = tmp_path / "t"
    token.write_text("hf_x", encoding="utf-8")
    ok = httpx.MockTransport(lambda req: httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": f"{RING} has risk 94."}}]}))
    r = ScriptedRouter()
    out = ChatService(ChatConfig(token_file=str(token), intent_model="x"), transport=ok, router=r).ask(ChatRequest(message=f"{RING}?"), StubBackend())
    assert out.mode == "llm" and r.asked == []


def test_when_the_hosted_models_fail_the_local_one_answers_and_the_note_keeps_both_reasons(tmp_path):
    token = tmp_path / "t"
    token.write_text("hf_x", encoding="utf-8")
    broke = httpx.MockTransport(lambda req: httpx.Response(402, json={"error": "no credits"}))
    r = ScriptedRouter("top_rings", 0.77)
    out = ChatService(ChatConfig(token_file=str(token), intent_model="x"), transport=broke, router=r).ask(ChatRequest(message="riskiest?"), StubBackend())
    assert out.mode == "local" and "no credits" in out.note and "0.77" in out.note and "Highest-risk rings" in out.answer


# -- status and the endpoints
def test_status_reports_local_when_the_model_is_ready_and_rules_when_it_failed():
    assert svc(ScriptedRouter()).status().mode == "local" and svc(ScriptedRouter()).status().intent_model == "ibm-granite/granite-embedding-30m-english"
    failed = svc(ScriptedRouter(fails="boom")).status()
    assert failed.mode == "rules" and failed.intent_model is None


def test_the_endpoints_report_and_answer_in_local_mode():
    s = svc(ScriptedRouter("status"))
    app.dependency_overrides[get_backend] = lambda: StubBackend()
    app.dependency_overrides[get_chat] = lambda: s
    try:
        c = TestClient(app)
        assert c.get("/chat/status").json()["mode"] == "local"
        body = c.post("/chat", json={"message": "is the backend alive"}).json()
        assert body["mode"] == "local" and "Backend: stub" in body["answer"] and "hf_" not in json.dumps(body)
    finally:
        app.dependency_overrides.clear()


def test_the_config_reads_the_model_folder_from_the_environment(monkeypatch):
    monkeypatch.setenv("NEXUSZ_CHAT_INTENT_MODEL", "/srv/nexusz/granite-embedding")
    assert ChatConfig.from_env().intent_model == "/srv/nexusz/granite-embedding"
    monkeypatch.setenv("NEXUSZ_CHAT_INTENT_MODEL", "  ")
    assert ChatConfig.from_env().intent_model is None


def test_a_local_folder_is_named_without_its_path(tmp_path):
    folder = tmp_path / "granite-embedding-30m-english"
    folder.mkdir()
    assert IntentRouter(str(folder)).name == "ibm-granite/granite-embedding-30m-english" and str(tmp_path) not in IntentRouter(str(folder)).name


# -- the examples and the question sets
def test_the_topics_of_the_examples_are_exactly_the_topics_the_rules_can_answer():
    assert set(EXAMPLES) == {"top_rings", "explain_top", "victims", "alerts", "status"}
    for topic in EXAMPLES:
        assert rules_answer("x", Tools(StubBackend()), [], topic, routed=True) != HELP


def test_no_evaluation_question_is_also_an_example():
    examples = {e.lower() for v in EXAMPLES.values() for e in v}
    asked = {q.lower() for q, _ in DEVELOPMENT + HELD_OUT + FRESH}
    assert not examples & asked, "an example question must not be tested against itself"


def test_the_question_sets_use_known_topics_and_do_not_overlap():
    topics = set(EXAMPLES) | {"none"}
    all_q = [q.lower() for q, _ in DEVELOPMENT + HELD_OUT + FRESH]
    assert {t for _, t in DEVELOPMENT + HELD_OUT + FRESH} == topics and len(all_q) == len(set(all_q))


def test_keyword_topic_still_covers_the_old_rules():
    assert keyword_topic("Why was the top ring flagged?") == "explain_top" and keyword_topic("Who may pay in next?") == "victims"
    assert keyword_topic("tell me a joke") is None


# -- the real model, when it is installed (the VM; set NEXUSZ_TEST_INTENT_MODEL to a folder or a Hugging Face name)
@pytest.mark.skipif(not os.environ.get("NEXUSZ_TEST_INTENT_MODEL"), reason="needs Granite Embedding; set NEXUSZ_TEST_INTENT_MODEL")
def test_the_real_model_beats_the_keywords_on_questions_it_was_not_tuned_on():
    router = IntentRouter(os.environ["NEXUSZ_TEST_INTENT_MODEL"])
    assert router.available(), router.failure
    got = sum((router.route(q)[0] or "none") == want for q, want in FRESH)
    kw = sum((keyword_topic(q) or "none") == want for q, want in FRESH)
    assert got / len(FRESH) >= 0.75 and got > kw, (got, kw)
    assert router.route("Which rings are riskiest?")[0] == "top_rings" and router.route("how do I cook pasta")[0] is None
