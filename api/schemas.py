"""Response and request shapes for the NEXUS Z API. These are the contract with the dashboard."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["victim", "collector", "mule", "cashout"]


class Transaction(BaseModel):
    tx_id: str
    ts: datetime
    src: str
    dst: str
    amount: float = Field(gt=0)
    channel: str


class IngestResult(BaseModel):
    accepted: int
    backend: str


class Reason(BaseModel):
    feature: str
    label: str
    contribution: float  # SHAP value; positive pushes the risk up


class Member(BaseModel):
    id: str
    role: Role
    score: float = Field(ge=0, le=1)


class Edge(BaseModel):
    src: str
    dst: str
    amount: float
    ts: datetime


class RingSummary(BaseModel):
    ring_id: str
    risk: int = Field(ge=0, le=100)
    accounts: int
    victims: int
    headline: str
    first_seen: datetime
    flagged_at: datetime


class Ring(RingSummary):
    total_amount: float
    members: list[Member]
    edges: list[Edge]
    top_reasons: list[Reason]


class Neighborhood(BaseModel):
    in_degree: int
    out_degree: int
    ring_size: int | None


class AccountScore(BaseModel):
    account_id: str
    risk: float = Field(ge=0, le=1)
    role: Role | None
    ring_id: str | None
    reasons: list[Reason]
    neighborhood: Neighborhood


class Alert(BaseModel):
    alert_id: str
    type: Literal["ring", "victim_warning"]
    severity: Literal["high", "medium", "low"]
    ring_id: str
    account_id: str | None
    recipient_id: str | None = None  # victim_warning only: the ring account that was paid; GET /accounts/<it> is the pre-check
    message: str
    ts: datetime
