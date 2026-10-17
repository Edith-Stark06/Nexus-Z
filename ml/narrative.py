"""Analyst case summaries: a generative model writes up what the predictive model found, and may only use the facts.

The detection is done by the trees (ml/service.py). This module does one thing on top: turn a ring's facts (size, roles,
payments, likely victims, the reasons behind its score) into two plain sentences for an analyst.

Safety comes from the design, not from trusting the model:
  * The facts are a fixed sheet built from the scorer's own output. The model is shown that sheet and two worked examples
    and asked to continue; temperature 0, at most MAX_TOKENS tokens.
  * Every number and every account or ring id in the answer must appear in the fact sheet, and none of the words in
    FORBIDDEN may appear. If anything fails, or the model or the library is missing, the deterministic template is returned
    instead, and the result says so (`source`, `verified`).
  * The template is always computed first, so an answer exists immediately; the model's text only replaces it when it passes.

The model is IBM Granite (4.0, 350M, base) run by llama.cpp built with zDNN, which sends its matrix multiplications to the
processor's NNPA facility. `python -m ml.accel_check granite` counts those operations with the hardware counters.
It is a base model without instruction tuning and writes slowly on 3 vCPUs (a few tokens a second), so summaries are made
on request and cached.
"""
import logging
import os
import re
import threading
import time
from pathlib import Path

log = logging.getLogger("nexusz.narrative")

DEFAULT_MODEL = "/home/ibm-user/granite-4.0-h-350m-base-be.f16.gguf"
MODEL_LABEL = "IBM Granite 4.0 350M (llama.cpp with zDNN)"
MAX_TOKENS = 70
FORBIDDEN = ("fraudster", "criminal", "guilty", "stolen", "scam", "scammer", "convicted", "arrest", "illegal")
ROLE_WORDS = {"victim": "likely victim", "collector": "collector", "mule": "mule", "cashout": "cash-out"}


# -- facts and the template
def clean_reason(label: str) -> str:
    """A reason label without its Sender:/Receiver: prefix, lower-case, ready to put in a sentence."""
    text = re.sub(r"^(Sender|Receiver): ", "", label).replace(" (absent)", "")
    return text[0].lower() + text[1:] if text else text


def fact_sheet(ring: dict, warnings: int = 0) -> dict:
    """Facts for one ring from GET /rings/{id}-style output. Only values that are really in `ring`."""
    roles: dict[str, int] = {}
    for m in ring["members"]:
        roles[m["role"]] = roles.get(m["role"], 0) + 1
    present = [r for r in ring["top_reasons"] if r.get("contribution", 0) > 0 and "(absent)" not in r["label"]]
    return {"ring_id": ring["ring_id"], "accounts": ring["accounts"], "payments": len(ring["edges"]),
            "risk": ring["risk"], "victims": roles.get("victim", 0), "collectors": roles.get("collector", 0),
            "mules": roles.get("mule", 0), "cashouts": roles.get("cashout", 0), "warnings": warnings,
            "signal": clean_reason(present[0]["label"]) if present else "an unusual payment pattern"}


def sheet_text(f: dict) -> str:
    return (f"Ring: {f['ring_id']}\nRisk: {f['risk']} of 100\nAccounts: {f['accounts']} "
            f"({f['victims']} likely victims, {f['collectors']} collectors, {f['mules']} mules, {f['cashouts']} cash-outs)\n"
            f"Payments between them: {f['payments']}\nPayers flagged as at risk of paying in again: {f['warnings']}\n"
            f"Main signal: {f['signal']}\n")


def template_summary(f: dict) -> str:
    return (f"Ring {f['ring_id']} links {f['accounts']} accounts through {f['payments']} payments and scores {f['risk']} of 100; "
            f"the main signal is that {f['signal']}. "
            f"It has {f['collectors']} collectors, {f['mules']} mules and {f['cashouts']} cash-outs, and {f['warnings']} recent payers "
            f"may be paying into it. Verify the accounts before any action; roles are estimates.")


EXAMPLES = [
    ({"ring_id": "RNG-1A2B3C", "accounts": 6, "payments": 18, "risk": 91, "victims": 2, "collectors": 1, "mules": 2,
      "cashouts": 1, "warnings": 3, "signal": "money leaves within minutes"},
     "RNG-1A2B3C links 6 accounts through 18 payments and scores 91 of 100, mainly because money leaves within minutes. "
     "Two likely victims pay one collector, who passes funds through 2 mules to a cash-out; 3 more payers may be at risk."),
    ({"ring_id": "RNG-9F8E7D", "accounts": 4, "payments": 9, "risk": 78, "victims": 1, "collectors": 1, "mules": 1,
      "cashouts": 1, "warnings": 0, "signal": "the same amounts repeat"},
     "RNG-9F8E7D links 4 accounts through 9 payments and scores 78 of 100, mainly because the same amounts repeat. "
     "One likely victim pays a collector, who forwards through a mule to a cash-out; no other payers are flagged."),
]


def prompt_for(f: dict) -> str:
    parts = ["Each fact sheet is followed by a two-sentence summary for a fraud analyst. "
             "The summary uses only numbers and ids from its fact sheet.\n"]
    for facts, summary in EXAMPLES:
        parts.append(f"Fact sheet\n{sheet_text(facts)}Summary: {summary}\n")
    parts.append(f"Fact sheet\n{sheet_text(f)}Summary:")
    return "\n".join(parts)


# -- the check
def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+", text))


NUMBER_WORDS = {"no": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
                "eight": "8", "nine": "9", "ten": "10"}


def verify(text: str, f: dict) -> tuple[bool, str]:
    """Whether `text` says nothing the fact sheet does not. Returns (passes, why not)."""
    allowed = _numbers(sheet_text(f)) | {"100"}
    ids = set(re.findall(r"\b(?:RNG|ACC)-[0-9A-F]{4,}\b", text))
    if not text.strip() or len(text) > 450:
        return False, "empty or too long"
    if ids - {f["ring_id"]}:
        return False, f"mentions ids not in the facts: {sorted(ids - {f['ring_id']})}"
    stray = _numbers(re.sub(r"\b(?:RNG|ACC)-[0-9A-F]+\b", "", text)) - allowed
    if stray:
        return False, f"numbers not in the facts: {sorted(stray)}"
    for word, digit in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", text, re.I) and digit not in allowed:
            return False, f"number word '{word}' not in the facts"
    low = text.lower()
    bad = [w for w in FORBIDDEN if w in low]
    if bad:
        return False, f"forbidden words: {bad}"
    if len(re.findall(r"[.!?](?:\s|$)", text)) < 1:
        return False, "no complete sentence"
    return True, ""


def _first_two_sentences(text: str) -> str:
    text = re.split(r"\n\s*\n|Fact sheet", text.strip())[0].strip()
    sentences = re.findall(r"[^.!?]+[.!?]", text)
    return " ".join(s.strip() for s in sentences[:2]) or text


# -- the model
class Narrator:
    """Loads Granite lazily, on the first request, and writes one summary at a time."""

    def __init__(self, model_path: str | None = None):
        self.path = model_path or os.environ.get("NEXUSZ_GRANITE_MODEL", DEFAULT_MODEL)
        self._llm = None
        self._lock = threading.Lock()
        self._cache: dict[tuple, dict] = {}
        self.unavailable: str | None = None

    def available(self) -> bool:
        if self.unavailable:
            return False
        if not Path(self.path).is_file():
            self.unavailable = f"model file not found: {self.path}"
        else:
            try:
                import llama_cpp  # noqa: F401
            except ImportError:
                self.unavailable = "llama_cpp is not installed"
        return self.unavailable is None

    def _load(self):
        if self._llm is None:
            from llama_cpp import Llama

            self._llm = Llama(model_path=self.path, n_ctx=2048, n_batch=512, n_threads=int(os.environ.get("NEXUSZ_LLM_THREADS", "3")),
                              verbose=False)
        return self._llm

    def summarize(self, f: dict) -> dict:
        """{"summary", "source", "verified", "seconds", "note"}. Always has a summary: the template, if the model does not pass."""
        key = tuple(sorted(f.items()))
        with self._lock:
            if key in self._cache:
                return self._cache[key]
            started = time.perf_counter()
            out = {"summary": template_summary(f), "source": "template", "verified": True, "note": ""}
            if not self.available():
                out["note"] = f"Granite not used: {self.unavailable}"
            else:
                try:
                    raw = self._load().create_completion(prompt_for(f), max_tokens=MAX_TOKENS, temperature=0,
                                                         stop=["\n\n", "Fact sheet"])["choices"][0]["text"]
                    text = _first_two_sentences(raw)
                    ok, why = verify(text, f)
                    if ok:
                        out.update(summary=text, source=MODEL_LABEL)
                    else:
                        out["note"] = f"Granite's text failed the facts check ({why}); the template is shown"
                        log.info("rejected model text: %s", why)
                except Exception as exc:  # a broken model must not break the page
                    out["note"] = f"Granite failed ({type(exc).__name__}); the template is shown"
                    log.warning("narrative model failed: %s", exc)
            out["seconds"] = round(time.perf_counter() - started, 2)
            self._cache[key] = out
            return out
