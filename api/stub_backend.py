"""Backend that serves invented sample rings. Replaced by the real model-backed backend later."""
from . import sample_data
from .schemas import AccountScore, Alert, Ring, RingSummary, Transaction


class StubBackend:
    name = "stub"

    def __init__(self) -> None:
        self._rings = {r.ring_id: r for r in sample_data.build_rings()}
        self._alerts = sample_data.build_alerts(list(self._rings.values()))
        self._accounts = {
            m.id: sample_data.build_account(r, m) for r in self._rings.values() for m in r.members
        }
        self.received: list[Transaction] = []

    def ingest(self, txs: list[Transaction]) -> int:
        self.received.extend(txs)
        return len(txs)

    def list_rings(self) -> list[RingSummary]:
        return [RingSummary(**r.model_dump(include=set(RingSummary.model_fields))) for r in self._rings.values()]

    def get_ring(self, ring_id: str) -> Ring | None:
        return self._rings.get(ring_id)

    def get_account(self, account_id: str) -> AccountScore | None:
        return self._accounts.get(account_id)

    def list_alerts(self, limit: int) -> list[Alert]:
        return self._alerts[:limit]
