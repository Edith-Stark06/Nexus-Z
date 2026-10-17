"""Analyst case summaries: exact facts from a template, plus one plain-language sentence from a generative model.

The detection is done by the trees (ml/service.py). This module turns a ring's facts (size, roles, payments, likely
victims, the main signal) into a short summary for an analyst.

The facts are never written by the model. A first version let IBM Granite 350M write the whole summary from a fact sheet, and
it bound numbers to the wrong facts ("Two likely victims" for a ring with one; "9 more payers" for none, where 9 was the
collector count), which a check that only asks "does this number appear on the sheet?" cannot catch. So now:
  * the template writes every number, role and id, deterministically;
  * Granite writes only an explanation of what the main signal means, in one sentence, from three worked examples
    (temperature 0, at most MAX_TOKENS tokens);
  * that sentence is accepted only if it has no digits, no ids, none of the words in FORBIDDEN, and is one clean sentence;
    otherwise (or if the model or the library is missing) the summary is the template alone and says so (`source`).

The explanation can still be wrong in meaning, which is why the result names the model that wrote it and the summary ends
with "Verify the accounts before any action; roles are estimates."

The model is IBM Granite (4.0, 350M, base) run by llama.cpp built with zDNN, which sends its matrix multiplications to the
processor's NNPA facility. `python -m ml.accel_check granite` counts those operations with the hardware counters.
It writes slowly on 3 vCPUs (a few tokens a second), so summaries are made on request and cached.
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
MAX_TOKENS = 45
FORBIDDEN = ("fraudster", "criminal", "guilty", "stolen", "scam", "scammer", "convicted", "arrest", "illegal")
CLOSING = "Verify the accounts before any action; roles are estimates."
# The model may state no quantity at all: digits and number words are both refused, because it cannot be trusted to attach a count to the right fact.
NUMBER_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "dozen",
                "hundred", "thousand", "million", "half", "double", "twice", "single", "both")

EXAMPLES = [
    ("money leaves within minutes",
     "Funds that arrive and are sent on almost at once are typical of accounts used to pass money along rather than to spend it."),
    ("the same amounts repeat",
     "Identical amounts repeated many times can mean payments are being split or scripted rather than made by ordinary customers."),
    ("payments flow back and forth",
     "Money moving back and forth between the same accounts can be a way to make the activity look normal."),
]


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


def facts_sentence(f: dict) -> str:
    return (f"Ring {f['ring_id']} links {f['accounts']} accounts through {f['payments']} payments and scores {f['risk']} of 100; "
            f"the main signal is that {f['signal']}. "
            f"It has {f['victims']} likely victims, {f['collectors']} collectors, {f['mules']} mules and {f['cashouts']} cash-outs, and "
            f"{f['warnings']} recent payers may be paying into it.")


def template_summary(f: dict, explanation: str = "") -> str:
    return " ".join(x for x in (facts_sentence(f), explanation, CLOSING) if x)


# -- the model's one sentence
def prompt_for(signal: str) -> str:
    parts = ["A fraud analyst sees a signal about a group of accounts. Each line explains in one plain sentence what the signal can "
             "mean. The sentence has no numbers and does not accuse anyone.\n"]
    parts += [f"Signal: {sig}\nMeaning: {meaning}\n" for sig, meaning in EXAMPLES]
    parts.append(f"Signal: {signal}\nMeaning:")
    return "\n".join(parts)


def verify_explanation(text: str) -> tuple[bool, str]:
    """Whether the model's sentence is safe to show: no numbers, no ids, no accusation, one clean sentence."""
    text = text.strip()
    if not 30 <= len(text) <= 240:
        return False, "too short or too long"
    low = text.lower()
    if re.search(r"\d", text) or re.search(r"\b(?:RNG|ACC)-", text) or re.search(rf"\b(?:{'|'.join(NUMBER_WORDS)})\b", low):
        return False, "contains a number or an id"
    bad = [w for w in FORBIDDEN if w in low]
    if bad:
        return False, f"forbidden words: {bad}"
    if len(re.findall(r"[.!?](?:\s|$)", text)) != 1 or not text.endswith((".", "!", "?")):
        return False, "not exactly one complete sentence"
    if re.search(r"\b(we|i|you|our|my)\b", low):
        return False, "speaks in the first or second person"
    return True, ""


def _first_sentence(text: str) -> str:
    text = re.split(r"\n|Signal:", text.strip())[0].strip()
    found = re.findall(r"[^.!?]+[.!?]", text)
    return found[0].strip() if found else text


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

            self._llm = Llama(model_path=self.path, n_ctx=2048, n_batch=512,
                              n_threads=int(os.environ.get("NEXUSZ_LLM_THREADS", "3")), verbose=False)
        return self._llm

    def summarize(self, f: dict) -> dict:
        """{"summary", "explanation", "source", "seconds", "note"}. The summary always exists: the template, with the
        model's sentence added only when it passes the check."""
        key = tuple(sorted(f.items()))
        with self._lock:
            if key in self._cache:
                return self._cache[key]
            started = time.perf_counter()
            out = {"summary": template_summary(f), "explanation": "", "source": "template", "note": ""}
            if not self.available():
                out["note"] = f"Granite not used: {self.unavailable}"
            else:
                try:
                    raw = self._load().create_completion(prompt_for(f["signal"]), max_tokens=MAX_TOKENS, temperature=0,
                                                         stop=["\n"])["choices"][0]["text"]
                    text = _first_sentence(raw)
                    ok, why = verify_explanation(text)
                    if ok:
                        out.update(summary=template_summary(f, text), explanation=text,
                                   source=f"template facts + explanation by {MODEL_LABEL}")
                    else:
                        out["note"] = f"Granite's sentence failed the check ({why}); the template alone is shown"
                        log.info("rejected model text: %s", why)
                except Exception as exc:  # a broken model must not break the page
                    out["note"] = f"Granite failed ({type(exc).__name__}); the template alone is shown"
                    log.warning("narrative model failed: %s", exc)
            out["seconds"] = round(time.perf_counter() - started, 2)
            self._cache[key] = out
            return out
