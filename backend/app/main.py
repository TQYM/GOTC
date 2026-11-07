"""FastAPI 入口：挂路由、中间件、异常处理器（06 §2），规划导师 90s 调度（04 §4）。"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.playback import ensure_playback
from app.api.sessions import get_registry, narrator
from app.api.sessions import router as sessions_router
from app.api.stream import sse_endpoint
from app.config import Settings
from app.contracts.errors import (
    HTTP_STATUS_BY_CODE,
    ErrorBody,
    ErrorCode,
    ErrorEnvelope,
)
from app.core.errors import GameError

log = logging.getLogger(__name__)
settings = Settings()

MENTOR_POLL_SEC = 5.0  # 调度循环粒度；90s 节流在 Narrator.mentor_comment


async def _mentor_loop() -> None:
    """规划导师定时点评：遍历活跃会话，90s 一条（core 不依赖 narrate，故放入口层）。"""
    while True:
        await asyncio.sleep(MENTOR_POLL_SEC)
        for session in get_registry().active_sessions():
            try:
                if session.finalized:
                    ensure_playback(session, narrator)  # polish 超时自动 finalize 的播放兜底
                else:
                    await narrator.mentor_comment(session)
            except Exception:  # 单会话失败不影响其他会话
                log.exception("mentor comment failed: %s", session.session_id)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(_mentor_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        get_registry().close()


app = FastAPI(title="CITY20 Backend", version=settings.app_version, lifespan=lifespan)
app.include_router(sessions_router)
app.add_api_route(
    "/api/sessions/{session_id}/stream",
    sse_endpoint,
    methods=["GET"],
    name="session_stream",
)


@app.exception_handler(GameError)
async def game_error_handler(_: Request, exc: GameError) -> JSONResponse:
    """领域错误 → 02 §1 统一信封。"""
    envelope = ErrorEnvelope(
        error=ErrorBody(code=exc.code, message=exc.message, details=exc.details)
    )
    return JSONResponse(status_code=HTTP_STATUS_BY_CODE[exc.code], content=envelope.model_dump())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """请求体缺字段/类型错 → 422 invalid_payload（02 §1）。"""
    # 手工提取可 JSON 序列化的字段（不同 FastAPI 版本 errors() 参数签名不同，避免耦合）
    simple_errors = [
        {
            "loc": [str(part) for part in e.get("loc", ())],
            "msg": str(e.get("msg")),
            "type": e.get("type"),
        }
        for e in exc.errors()
    ]
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code=ErrorCode.INVALID_PAYLOAD,
            message="请求体缺字段或类型错误",
            details={"errors": simple_errors},
        )
    )
    return JSONResponse(status_code=422, content=envelope.model_dump())


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    """进程存活探活（06 §7）：存活 + 会话数 + 配置摘要（脱敏）。"""
    return {"status": "ok", "version": settings.app_version, "sessions": get_registry().count()}
