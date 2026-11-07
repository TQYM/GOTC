"""FastAPI 入口：挂路由、中间件、异常处理器（06 §2）。"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.sessions import get_registry
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

settings = Settings()

app = FastAPI(title="CITY20 Backend", version=settings.app_version)
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
