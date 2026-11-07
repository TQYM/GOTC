"""会话级 REST 响应形状（02 §3.1 / §3.2 / §3.3 / §3.5）。"""

from pydantic import BaseModel, Field

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
