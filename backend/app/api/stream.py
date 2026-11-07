"""SSE 事件流端点（02 §3.8 / 06 §4）：真 broadcaster——快照/补发/实时推送。

- 新连接或缓冲溢出：phase_change + 全量 tick 快照重置前端。
- Last-Event-ID 在缓冲范围内：只补发其后事件（断连 30s 内重连可补发）。
- 心跳由 core/timer 的 15s 任务发布，所有事件共享单调 id。
"""

import json
from typing import Annotated

from fastapi import Depends, Request
from sse_starlette.sse import EventSourceResponse

from app.api.sessions import get_session
from app.core.session import GameSession


async def _event_stream(session: GameSession, last_event_id: int | None):
    broadcaster = session.broadcaster
    queue = broadcaster.subscribe()  # 先订阅再取快照，期间的增量经 cutoff 去重
    cutoff = broadcaster.latest_id
    try:
        replay = None
        if last_event_id is not None:
            replay = broadcaster.replay_after(last_event_id)
        if last_event_id is None or replay is None:
            # 新连接 / 缓冲溢出：快照重置（06 §4 末条）
            for event, data in session.snapshot_events():
                yield {
                    "id": str(cutoff),
                    "event": event,
                    "data": json.dumps(data, ensure_ascii=False),
                }
        elif replay:
            for entry in replay:
                if entry.id <= cutoff:
                    yield entry.sse_frame()
        while True:
            entry = await queue.get()
            if entry.id <= cutoff:
                continue  # 快照/补发已覆盖
            yield entry.sse_frame()
    finally:
        broadcaster.unsubscribe(queue)


def sse_endpoint(
    request: Request,
    session: Annotated[GameSession, Depends(get_session)],
) -> EventSourceResponse:
    raw_last_id = request.headers.get("last-event-id")
    try:
        last_event_id = int(raw_last_id) if raw_last_id is not None else None
    except ValueError:
        last_event_id = None  # 非法头按新连接处理
    return EventSourceResponse(_event_stream(session, last_event_id))


__all__ = ["sse_endpoint"]
