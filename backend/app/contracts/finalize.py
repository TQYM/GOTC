"""finalize 响应形状（02 §3.6），结局判定见 01 §7。"""

from enum import StrEnum

from pydantic import BaseModel, Field

from app.contracts.metrics import Metrics, Phase


class Ending(StrEnum):
    BANKRUPT = "bankrupt"
    ECO_PARADISE = "eco_paradise"
    GRIDLOCK = "gridlock"
    GHOST_TOWN = "ghost_town"
    THRIVING = "thriving"
    ORDINARY = "ordinary"


class Scores(BaseModel):
    population: int = Field(ge=0, le=100)
    balance: int = Field(ge=0, le=100)
    green: int = Field(ge=0, le=100)
    traffic: int = Field(ge=0, le=100)
    happiness: int = Field(ge=0, le=100)


class ProjectionYear(BaseModel):
    year: int = Field(ge=1)
    metrics: Metrics
    events: list[str] = Field(default_factory=list)


class FinalizeResult(BaseModel):
    phase: Phase = Phase.LOCKED
    projection: list[ProjectionYear]
    ending: Ending
    scores: Scores
    report_text: str
