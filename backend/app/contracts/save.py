"""saves v2 REST 契约（docs/plan/02）。"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.contracts.common import Source
from app.contracts.events import Report
from app.contracts.finalize import Ending, ProjectionYear, Scores
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import Parcel
from app.contracts.tile import PlaceRequest, Tile


class CreateSaveRequest(BaseModel):
    seed: int | None = None
    name: str | None = Field(default=None, max_length=40)
    parcel_id: Literal["beijing_cbd", "beijing_core", "sandbox"] = "beijing_cbd"


class SaveState(BaseModel):
    save_id: str
    city_code: str = Field(min_length=8, max_length=8)
    name: str
    parcel: Parcel
    tiles: list[Tile]
    redeveloped_asset_ids: list[str] = Field(default_factory=list)
    metrics: Metrics
    city_year: int = Field(ge=1)
    phase: Phase
    last_seq: int = Field(ge=0)


class OperationRequest(BaseModel):
    client_op_id: str = Field(min_length=1, max_length=128)
    base_seq: int = Field(default=0, ge=0)


class SavePlaceRequest(PlaceRequest, OperationRequest):
    pass


class SaveRemoveRequest(OperationRequest):
    tile_id: str = Field(min_length=1, max_length=64)


class RedevelopRequest(OperationRequest):
    anchor: list[int]

    @field_validator("anchor")
    @classmethod
    def _check_anchor(cls, value: list[int]) -> list[int]:
        if len(value) != 2 or any(not isinstance(v, int) or v < 0 for v in value):
            raise ValueError("anchor 必须是 [r, c] 非负整数")
        return value


class RedevelopmentResult(BaseModel):
    asset_id: str
    cells: list[list[int]]
    demolition_cost: int = Field(ge=0)
    population_removed: int = Field(ge=0)
    jobs_removed: int = Field(ge=0)
    happiness_delta: int = -5
    penalty_until_year: int = Field(ge=1)


class OperationResult(BaseModel):
    seq: int = Field(ge=1)
    op_type: Literal["place", "remove", "redevelop", "advance"]
    client_op_id: str
    payload: dict[str, Any]
    tile: Tile | None = None
    tiles: list[Tile]
    redeveloped_asset_ids: list[str] = Field(default_factory=list)
    metrics: Metrics
    metrics_diff: MetricsDiff
    funds_after: int
    city_year: int = Field(ge=1)
    annual_events: list[str] = Field(default_factory=list)
    redevelopment: RedevelopmentResult | None = None


class ProjectRequest(BaseModel):
    years: int = Field(default=10, ge=1, le=20)


class ProjectionResult(BaseModel):
    projection_id: str
    base_year: int = Field(ge=1)
    base_seq: int = Field(ge=0)
    projection: list[ProjectionYear]


class ReportResult(BaseModel):
    report_id: str
    created_at: str
    base_year: int = Field(ge=1)
    base_seq: int = Field(ge=0)
    scores: Scores
    ending: Ending
    report: Report
    city_name: str
    city_name_source: Source


class ReportList(BaseModel):
    reports: list[ReportResult]


class MentorAccepted(BaseModel):
    accepted: Literal[True] = True
