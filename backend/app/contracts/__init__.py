"""前后端契约模型（02 文档的代码化身），按数据形状分文件。

任何人不得单方面变更字段名/枚举值；修改流程见 02 §0.1。
"""

from app.contracts.errors import (
    HTTP_STATUS_BY_CODE,
    ErrorBody,
    ErrorCode,
    ErrorEnvelope,
)
from app.contracts.events import (
    CitizenEvent,
    CitizenSentiment,
    CitizenTopic,
    MentorEvent,
    MentorSeverity,
    NewsEvent,
    NewsSeverity,
    PhaseChangeEvent,
    ProjectionStep,
    ReportReadyEvent,
    SseErrorEvent,
    TheoryRef,
)
from app.contracts.finalize import (
    Ending,
    FinalizeResult,
    ProjectionYear,
    Scores,
)
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import (
    CreateSessionRequest,
    Parcel,
    ParcelConstraints,
    Terrain,
)
from app.contracts.session import (
    AdvanceResponse,
    PlaceResult,
    RemoveResult,
    SessionCreated,
    SessionState,
)
from app.contracts.tile import PlaceRequest, RemoveRequest, Tile, TileType

__all__ = [
    "AdvanceResponse",
    "CitizenEvent",
    "CitizenSentiment",
    "CitizenTopic",
    "CreateSessionRequest",
    "Ending",
    "ErrorBody",
    "ErrorCode",
    "ErrorEnvelope",
    "FinalizeResult",
    "HTTP_STATUS_BY_CODE",
    "MentorEvent",
    "MentorSeverity",
    "Metrics",
    "MetricsDiff",
    "NewsEvent",
    "NewsSeverity",
    "Parcel",
    "ParcelConstraints",
    "Phase",
    "PhaseChangeEvent",
    "PlaceRequest",
    "PlaceResult",
    "ProjectionStep",
    "ProjectionYear",
    "RemoveRequest",
    "RemoveResult",
    "ReportReadyEvent",
    "Scores",
    "SessionCreated",
    "SessionState",
    "SseErrorEvent",
    "Terrain",
    "TheoryRef",
    "Tile",
    "TileType",
]
