"""会话级 REST 响应形状（02 §3.1 / §3.2 / §3.3 / §3.5）。"""

from pydantic import BaseModel, Field, model_validator

from app.contracts.common import Source
from app.contracts.events import Report
from app.contracts.finalize import Ending, ProjectionYear, Scores
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import Parcel
from app.contracts.tile import Tile


class SessionCreated(BaseModel):
    session_id: str
    parcel: Parcel
    phase: Phase
    time_left_sec: int = Field(ge=0)
    funds: int


class SessionState(BaseModel):
    session_id: str
    phase: Phase
    time_left_sec: int = Field(ge=0)
    parcel: Parcel
    tiles: list[Tile]
    metrics: Metrics
    placements_count: int = Field(ge=0)
    projection: list[ProjectionYear] = Field(default_factory=list)
    projection_published_year: int = Field(default=0, ge=0)
    scores: Scores | None = None
    ending: Ending | None = None
    report: Report | None = None
    city_name: str | None = None
    city_name_source: Source | None = None

    @model_validator(mode="after")
    def _check_city_name_source(self) -> "SessionState":
        if (self.city_name is None) != (self.city_name_source is None):
            raise ValueError("city_name 与 city_name_source 必须同时为空或同时有值")
        return self


class PlaceResult(BaseModel):
    tile: Tile
    metrics: Metrics
    metrics_diff: MetricsDiff
    funds_after: int


# 拆除响应同构（tile 为被拆区块的遗照，02 §3.4）
RemoveResult = PlaceResult


class AdvanceResponse(BaseModel):
    phase: Phase
    time_left_sec: int = Field(ge=0)
