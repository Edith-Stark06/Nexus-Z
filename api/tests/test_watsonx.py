"""IBM watsonx.ai as the hosted model: sign-in with an API key, the chat call, fallbacks and secrecy, against a scripted fake (no network)."""
import json
import logging
from urllib.parse import parse_qs

import httpx
import pytest

from api.chat import DEFAULT_WATSONX_MODELS, IAM_URL, ChatConfig, ChatRequest, ChatService
from api.stub_backend import StubBackend

KEY = "WATSONX_SECRET_API_KEY_123"
IAM_TOKEN = "iam-bearer-token-456"
URL = "https://eu-de.ml.cloud.ibm.com"
PROJECT = "4947c695-a374-428c-acca-332c1a1dc9e9"
RING = "RNG-0417"


class FakeIbm:
    """Answers the IAM sign-in and the chat endpoint from a script; remembers every request."""

    def __init__(self, *chat_replies, iam=(200, None)):
        self.chat_replies, self.iam, self.chat, self.signins = list(chat_replies), iam, [], []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) == IAM_URL:
            self.signins.append(parse_qs(request.content.decode()))
            status, body = self.iam
            return httpx.Response(status, json=body or {"access_token": IAM_TOKEN, "expires_in": 3600})
        self.chat.append((request, json.loads(request.content)))
        status, body = self.chat_replies.pop(0) if self.chat_replies else (503, {"errors": ["script ended"]})
        return httpx.Response(status, json=body)


def say(text):
    return 200, {"choices": [{"message": {"role": "assistant", "content": text}}]}


def call(name, **args):
    return 200, {"choices": [{"message": {"role": "assistant", "tool_calls": [
        {"id": "H6KoCbaZV", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}, "finish_reason": "tool_calls"}]}


def service(fake, tmp_path, **kw):
    key = tmp_path / "key"
    key.write_text(KEY + "\n", encoding="utf-8")
    cfg = ChatConfig(token_file=str(tmp_path / "no-hf-token"), watsonx_url=kw.pop("url", URL), watsonx_project=kw.pop("project", PROJECT),
                     watsonx_key_file=str(key), **kw)
    return ChatService(cfg, transport=httpx.MockTransport(fake))


def ask(svc, text):
    return svc.ask(ChatRequest(message=text), StubBackend())


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("HF_TOKEN", "WATSONX_APIKEY"):
        monkeypatch.delenv(name, raising=False)


def test_a_question_signs_in_with_the_api_key_then_calls_the_chat_endpoint_with_the_iam_token(tmp_path):
    fake = FakeIbm(call("get_ring", ring_id=RING), say(f"{RING} is flagged with risk 94."))
    out = ask(service(fake, tmp_path), f"Tell me about {RING}")
    assert out.mode == "llm" and out.model == DEFAULT_WATSONX_MODELS[0] and out.provider == URL and out.warnings == []
    assert fake.signins == [{"grant_type": ["urn:ibm:params:oauth:grant-type:apikey"], "apikey": [KEY]}]
    request, body = fake.chat[0]
    assert request.url.path == "/ml/v1/text/chat" and request.url.params["version"] and request.url.host == "eu-de.ml.cloud.ibm.com"
    assert request.headers["authorization"] == f"Bearer {IAM_TOKEN}" and KEY not in request.headers["authorization"]
    assert body["model_id"] == DEFAULT_WATSONX_MODELS[0] and body["project_id"] == PROJECT and body["tool_choice_option"] == "auto"
    assert "model" not in body and "reasoning_effort" not in body and "tool_choice" not in body
    assert {t["function"]["name"] for t in body["tools"]} == {"list_rings", "get_ring", "get_account", "list_alerts", "system_status"}
    assert fake.chat[1][1]["messages"][-1]["role"] == "tool" and RING in fake.chat[1][1]["messages"][-1]["content"]


def test_the_iam_token_is_reused_for_later_questions(tmp_path):
    fake = FakeIbm(say(f"{RING} has risk 94."), say(f"{RING} has risk 94."))
    svc = service(fake, tmp_path)
    ask(svc, f"{RING}?")
    ask(svc, f"{RING} again?")
    assert len(fake.signins) == 1 and len(fake.chat) == 2


def test_a_rejected_api_key_stops_at_once_and_the_rules_answer(tmp_path):
    fake = FakeIbm(say("never"), iam=(400, {"errorMessage": "Provided API key could not be found"}))
    out = ask(service(fake, tmp_path), "Which rings are riskiest?")
    assert out.mode == "rules" and "rejected the API key" in out.note and fake.chat == [] and KEY not in out.model_dump_json()


def test_a_model_the_account_cannot_use_falls_through_to_the_next_one(tmp_path):
    fake = FakeIbm((400, {"errors": [{"code": "model_not_supported"}]}), say(f"{RING} has risk 94."))
    models = ["ibm/granite-4-h-small", "ibm/granite-other"]
    out = ask(service(fake, tmp_path, watsonx_models=models), f"{RING}?")
    assert out.mode == "llm" and out.model == models[1] and [b["model_id"] for _, b in fake.chat] == models


@pytest.mark.parametrize("status", [401, 402, 403])
def test_credential_and_quota_errors_stop_at_once(tmp_path, status):
    fake = FakeIbm((status, {"errors": ["x"]}), say("never"))
    out = ask(service(fake, tmp_path), "Which rings are riskiest?")
    assert out.mode == "rules" and len(fake.chat) == 1 and "Highest-risk rings" in out.answer


def test_the_same_checks_apply_to_a_watsonx_answer(tmp_path):
    fake = FakeIbm(say("RNG-FFFFFF is the riskiest ring."), say("Ring 0417 is fine."))
    out = ask(service(fake, tmp_path, watsonx_models=["ibm/granite-4-h-small"]), "Which rings are riskiest?")
    assert out.mode == "rules" and "no tool returned" in out.note and "RNG-FFFFFF" not in out.answer


def test_the_api_key_and_the_iam_token_never_reach_a_response_a_status_or_the_logs(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    fake = FakeIbm((503, {"error": KEY}), (503, {"error": IAM_TOKEN}))
    svc = service(fake, tmp_path)
    out = ask(svc, "Which rings are riskiest?")
    blob = out.model_dump_json() + svc.status().model_dump_json() + caplog.text
    assert KEY not in blob and IAM_TOKEN not in blob


def test_status_names_watsonx_and_its_models(tmp_path):
    st = service(FakeIbm(), tmp_path).status()
    assert st.mode == "llm" and st.provider == URL and st.models == DEFAULT_WATSONX_MODELS and st.token_configured is True


def test_without_a_project_or_url_the_hugging_face_path_is_used(tmp_path):
    svc = service(FakeIbm(), tmp_path, project=None)
    assert svc.config.provider == "huggingface" and svc.status().mode == "rules"      # no HF token either
    assert service(FakeIbm(), tmp_path, url=None).config.provider == "huggingface"


def test_the_config_reads_watsonx_from_the_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("NEXUSZ_WATSONX_URL", URL + "/")
    monkeypatch.setenv("NEXUSZ_WATSONX_PROJECT_ID", PROJECT)
    monkeypatch.setenv("NEXUSZ_WATSONX_KEY_FILE", str(tmp_path / "missing"))
    monkeypatch.setenv("WATSONX_APIKEY", KEY)
    monkeypatch.setenv("NEXUSZ_WATSONX_MODELS", "ibm/granite-3-8b-instruct, ibm/granite-4-h-small")
    cfg = ChatConfig.from_env()
    assert cfg.watsonx_url == URL and cfg.watsonx_project == PROJECT and cfg.provider == "watsonx"
    assert cfg.watsonx_models == ["ibm/granite-3-8b-instruct", "ibm/granite-4-h-small"] and cfg.secret() == KEY
