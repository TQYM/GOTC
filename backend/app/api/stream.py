"""SSE 事件流端点（02 §3.8）桩：推固定文案假事件流。

PR-13 换真 broadcaster（环形缓冲/心跳/断点补发），本端点形状不变。
"""

from typing import Annotated

from fastapi import Depends
from sse_starlette.sse import EventSourceResponse

from app.api.sessions import get_session
from app.contracts.events import (
    CitizenEvent,
    CitizenSentiment,
    CitizenTopic,
    MentorEvent,
    MentorSeverity,
    NewsEvent,
    NewsSeverity,
    PhaseChangeEvent,
    TheoryRef,
)
from app.contracts.metrics import MetricsDiff
from app.core.session import GameSession

# 假事件文案（02 §0.2：SSE 桩 = 固定文案假流）
_STUB_EVENTS = [
    (
        "news",
        NewsEvent(
            headline="（桩）城市电台开播",
            body="数据大脑接入中，当前为假数据流。",
            severity=NewsSeverity.INFO,
            at_year=1,
        ),
    ),
    (
        "citizen",
        CitizenEvent(
            persona="程序员小李",
            text="（桩）沙盘就位，等市长开工。",
            sentiment=CitizenSentiment.NEUTRAL,
            topic=CitizenTopic.COMMUTE,
        ),
    ),
    (
        "mentor",
        MentorEvent(
            comment="（桩）先通后畅：路网骨架优先于单点地标。",
            theory_refs=[TheoryRef.ROAD_HIERARCHY],
            severity=MentorSeverity.SUGGESTION,
        ),
    ),
]


async def _stub_stream(session: GameSession):
    yield {
        "event": "phase_change",
        "data": PhaseChangeEvent(
            phase=session.phase, time_left_sec=session.time_left_sec
        ).model_dump_json(),
    }
    yield {
        "event": "tick",
        "data": MetricsDiff(at_year=1, delta={}).model_dump_json(),
    }
    for event_name, payload in _STUB_EVENTS:
        yield {"event": event_name, "data": payload.model_dump_json()}


# 路由对象在 main.py 以 /api/sessions/{session_id}/stream 路径挂载


def sse_endpoint(
    session: Annotated[GameSession, Depends(get_session)],
) -> EventSourceResponse:
    return EventSourceResponse(_stub_stream(session))


__all__ = ["sse_endpoint"]
