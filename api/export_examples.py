"""Write the stub backend's responses to api/examples/*.json for front-end work without a server.

Usage (from the repo root):  python -m api.export_examples
"""
import json
from pathlib import Path

from .stub_backend import StubBackend

OUT = Path(__file__).parent / "examples"


def dump(name: str, payload) -> None:
    (OUT / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    backend = StubBackend()
    summaries = sorted(backend.list_rings(), key=lambda r: r.risk, reverse=True)
    dump("rings.json", [r.model_dump(mode="json") for r in summaries])
    for s in summaries:
        dump(f"ring_{s.ring_id}.json", backend.get_ring(s.ring_id).model_dump(mode="json"))
    dump("account_ACC-7F3A.json", backend.get_account("ACC-7F3A").model_dump(mode="json"))
    dump("alerts.json", [a.model_dump(mode="json") for a in backend.list_alerts(50)])
    print(f"wrote {len(list(OUT.glob('*.json')))} files to {OUT}")


if __name__ == "__main__":
    main()
