"""Metrics 指标快照与 MetricsDiff 变化量（02 §2.3 / §2.4），语义见 01 §4。"""

from enum import StrEnum

from pydantic import BaseModel, Field


class Phase(StrEnum):
    BRIEFING = "briefing"
    BUILD = "build"
    POLISH = "polish"
    LOCKED = "locked"
    REPORT = "report"


class Metrics(BaseModel):
    at_year: int = Field(ge=1)
    at_phase: Phase
    funds: int
    population: int = Field(ge=0)
    jobs: int = Field(ge=0)
    job_res_ratio: float = Field(ge=0.0)
    land_price_index: float = Field(ge=0.0)
    green_ratio: float = Field(ge=0.0, le=1.0)
    avg_commute: int = Field(ge=0)
    congestion: float = Field(ge=0.0)
    pollution: float = Field(ge=0.0, le=1.0)
    happiness: int = Field(ge=0, le=100)
    tax_income: int = Field(ge=0)
    upkeep: int = Field(ge=0)
    coverage_edu: float = Field(ge=0.0, le=1.0)
    coverage_med: float = Field(ge=0.0, le=1.0)


class MetricsDiff(BaseModel):
    at_year: int = Field(ge=1)
    delta: dict[str, int | float] = Field(default_factory=dict)
    after: Metrics | None = None
