"""Understands which question an analyst is asking, with IBM Granite Embedding (30M parameters, Apache 2.0), on the machine that serves the API.

A small language model could not write reliable answers on the VM's 3 CPUs (docs/CHATBOT.md), but an embedding model is small and fast: it turns the
question and a few example questions per topic into vectors, and the closest example decides the topic. Nothing is generated. The answer text still
comes from fixed sentences filled with facts from our own API, so this module cannot make a fact up; the worst it can do is pick the wrong topic.

Dependencies (torch, transformers) are imported only when the model is first used, so the API starts without them and falls back to keywords.
"""
import logging
import threading
from pathlib import Path

log = logging.getLogger("nexusz.intent")

DEFAULT_MODEL = "ibm-granite/granite-embedding-30m-english"
# Measured on the VM (docs/CHATBOT.md): 0.65 gave the best result on the development questions; 0.60 and 0.70 were clearly worse on a held-out set.
DEFAULT_THRESHOLD = 0.65
MAX_TOKENS = 64

# Example questions per topic. Written before the held-out questions, and not copied from them.
EXAMPLES: dict[str, list[str]] = {
    "top_rings": [
        "rank the rings by risk", "which rings are most dangerous", "the biggest threats we have", "the riskiest rings", "list the highest risk rings",
        "most suspicious rings to review", "top rings by risk score", "which rings should I review first",
    ],
    "explain_top": [
        "walk me through why the highest ranked ring was flagged", "what evidence supports the top ring", "why was the top ring flagged",
        "explain the riskiest ring", "what are the reasons behind the highest risk ring", "describe the number one ring in detail",
        "what is suspicious about the top ring",
    ],
    "victims": [
        "who is about to be scammed", "potential targets of the fraud rings", "likely victims of the rings", "who may pay in next",
        "payers who recently sent money to a flagged ring", "which customers should be warned", "people at risk of losing money",
    ],
    "alerts": [
        "any new warnings or flags raised", "pending alarms", "the newest alerts", "latest alerts raised", "recent alert list", "show current alerts",
        "what alerts were generated",
    ],
    "status": [
        "how recent is this information", "are the numbers live or stale", "how current is the data", "system status",
        "when was the data last refreshed", "is the system healthy", "data freshness",
    ],
}


class IntentRouter:
    """`route(question)` returns (topic, similarity). Topic is None when nothing is close enough, which means "not a question we can answer"."""

    def __init__(self, model: str = DEFAULT_MODEL, threshold: float = DEFAULT_THRESHOLD):
        self.model_name, self.threshold = model, threshold
        self._lock = threading.Lock()
        self._ready = False
        self._failed: str | None = None
        self._tok = self._model = self._vectors = self._labels = None

    @property
    def name(self) -> str:
        """The model's Hugging Face name. A local folder is reported as ibm-granite/<folder name>, so no path leaks into answers."""
        path = Path(self.model_name)
        return f"ibm-granite/{path.name}" if path.is_dir() else self.model_name

    def available(self) -> bool:
        """True when the model can be loaded (loads it once; the answer is remembered)."""
        if self._ready:
            return True
        with self._lock:
            if self._ready:
                return True
            if self._failed is not None:
                return False
            try:
                self._load()
            except Exception as exc:                      # missing packages, missing files, no network: all mean "use keywords"
                self._failed = f"{type(exc).__name__}: {exc}"[:200]
                log.warning("intent model unavailable (%s); keywords will be used", self._failed)
                return False
            self._ready = True
            return True

    @property
    def failure(self) -> str | None:
        return self._failed

    def _load(self) -> None:
        import torch
        from transformers import AutoModel, AutoTokenizer

        self._torch = torch
        self._tok = AutoTokenizer.from_pretrained(self.model_name)
        self._model = AutoModel.from_pretrained(self.model_name, dtype=torch.float32).eval()    # float32: the stored bfloat16 cannot be turned into numpy
        texts, labels = [], []
        for topic, examples in EXAMPLES.items():
            texts += examples
            labels += [topic] * len(examples)
        self._vectors, self._labels = self._embed(texts), labels

    def _embed(self, texts: list[str]):
        torch = self._torch
        with torch.no_grad():
            batch = self._tok(texts, padding=True, truncation=True, max_length=MAX_TOKENS, return_tensors="pt")
            out = self._model(**batch).last_hidden_state[:, 0].float()      # CLS pooling, as the model's own pooling config says
            return torch.nn.functional.normalize(out, dim=-1)

    def scores(self, question: str) -> dict[str, float]:
        """The similarity to the closest example of every topic."""
        if not self.available():
            return {}
        with self._lock:
            sims = (self._embed([question]) @ self._vectors.T)[0].tolist()
        best: dict[str, float] = {}
        for label, sim in zip(self._labels, sims):
            best[label] = max(sim, best.get(label, -1.0))
        return best

    def route(self, question: str) -> tuple[str | None, float]:
        best = self.scores(question)
        if not best:
            return None, 0.0
        topic = max(best, key=best.get)
        return (topic if best[topic] >= self.threshold else None), round(best[topic], 3)
