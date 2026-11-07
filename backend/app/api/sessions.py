"""REST 端点（02 §3）：桩接口——真地块生成 + 内置假指标/推演。

联调点 A 后内部逐步换真身（PR-06 起），接口形状不变。
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.playback import ensure_playback
from app.config import load_sim_config
from app.contracts.errors import ErrorCode
from app.contracts.finalize import FinalizeResult
from app.contracts.parcel import CreateSessionRequest
from app.contracts.session import (
    AdvanceResponse,
    PlaceResult,
    RemoveResult,
    SessionCreated,
    SessionState,
)
from app.contracts.tile import PlaceRequest, RemoveRequest
from app.core.errors import GameError
from app.core.session import GameSession
from app.core.store import SessionRegistry
from app.narrate.router import Narrator, schedule_news

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# 单进程单实例（06 §3）；测试可直接替换此单例
registry = SessionRegistry(load_sim_config())
narrator = Narrator()  # 数据大脑（04 §2）；无 key 时全模板降级


def get_registry() -> SessionRegistry:
    return registry


def get_session(
    session_id: str,
    reg: Annotated[SessionRegistry, Depends(get_registry)],
) -> GameSession:
    session = reg.get(session_id)
    if session is None:
        raise GameError(
            ErrorCode.SESSION_NOT_FOUND,
            "会话不存在或已过期",
            details={"session_id": session_id},
        )
    return session


@router.post("", status_code=201, response_model=SessionCreated)
async def create_session(
    body: Annotated[CreateSessionRequest | None, Body()] = None,
) -> SessionCreated:
    session = registry.create(seed=body.seed if body else None)
    return SessionCreated(
        session_id=session.session_id,
        parcel=session.parcel,
        phase=session.phase,
        time_left_sec=session.time_left_sec,
        funds=session.funds,
    )


@router.get("/{session_id}", response_model=SessionState)
async def get_state(session: Annotated[GameSession, Depends(get_session)]) -> SessionState:
    fr = session.finalize_result
    return SessionState(
        session_id=session.session_id,
        phase=session.phase,
        time_left_sec=session.time_left_sec,
        parcel=session.parcel,
        tiles=list(session.tiles.values()),
        metrics=session.metrics,
        placements_count=session.placements_count,
        projection=fr.projection if fr else [],
        projection_published_year=session.projection_published_year,
        scores=fr.scores if fr else None,
        ending=fr.ending if fr else None,
        report=fr.report if fr else None,
        city_name=fr.city_name if fr else None,
        city_name_source=fr.city_name_source if fr else None,
    )


@router.post("/{session_id}/place", response_model=PlaceResult)
async def place(
    body: PlaceRequest,
    session: Annotated[GameSession, Depends(get_session)],
) -> PlaceResult:
    async with session.lock:
        before = session.metrics
        tile, metrics, diff, funds_after = session.place(
            body.type, body.anchor, orientation=body.orientation
        )
    schedule_news(session, before, metrics, body.type.value, narrator, body.anchor)
    return PlaceResult(tile=tile, metrics=metrics, metrics_diff=diff, funds_after=funds_after)


@router.post("/{session_id}/remove", response_model=RemoveResult)
async def remove(
    body: RemoveRequest,
    session: Annotated[GameSession, Depends(get_session)],
) -> RemoveResult:
    async with session.lock:
        before = session.metrics
        tile, metrics, diff, funds_after = session.remove(body.tile_id)
    schedule_news(session, before, metrics, tile.type.value, narrator, tile.anchor)
    return RemoveResult(tile=tile, metrics=metrics, metrics_diff=diff, funds_after=funds_after)


@router.post("/{session_id}/advance", response_model=AdvanceResponse)
async def advance(
    session: Annotated[GameSession, Depends(get_session)],
) -> AdvanceResponse:
    async with session.lock:
        phase, time_left = session.advance()
    return AdvanceResponse(phase=phase, time_left_sec=time_left)


@router.post("/{session_id}/finalize", response_model=FinalizeResult)
async def finalize(
    session: Annotated[GameSession, Depends(get_session)],
) -> FinalizeResult:
    async with session.lock:
        result = session.finalize()
    ensure_playback(session, narrator)  # 02 §3.8：3.5s/年播放 → report_ready
    return result


@router.post("/{session_id}/restart", status_code=201, response_model=SessionCreated)
async def restart(
    body: Annotated[CreateSessionRequest | None, Body()] = None,
) -> SessionCreated:
    """等价于新建（02 §3.7）：可带相同 seed 复现同款地块。"""
    session = registry.create(seed=body.seed if body else None)
    return SessionCreated(
        session_id=session.session_id,
        parcel=session.parcel,
        phase=session.phase,
        time_left_sec=session.time_left_sec,
        funds=session.funds,
    )


__all__ = ["router", "get_registry"]
