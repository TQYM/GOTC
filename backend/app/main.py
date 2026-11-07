"""CITY20 saves v2 FastAPI 入口。"""

import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.saves import get_service
from app.api.saves import router as saves_router
from app.config import Settings
from app.contracts.errors import (
    HTTP_STATUS_BY_CODE,
    ErrorBody,
    ErrorCode,
    ErrorEnvelope,
)
from app.core.errors import GameError

settings = Settings()
_rate_windows: dict[tuple[str, str], deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    _rate_windows.clear()
    await get_service().initialize()
    try:
        yield
    finally:
        await get_service().close()


app = FastAPI(title="CITY20 Backend", version=settings.app_version, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(saves_router)
app.mount(
    "/static/parcels",
    StaticFiles(directory=Path(settings.parcel_data_dir), check_dir=False),
    name="parcels",
)


@app.middleware("http")
async def city_code_rate_limit(request: Request, call_next):
    """按 IP + 城市码限流，降低 8 位城市码枚举与写放大风险。"""
    if not request.url.path.startswith("/api/saves"):
        return await call_next(request)
    parts = request.url.path.split("/")
    scope = parts[3].upper() if len(parts) > 3 and parts[3] else "create"
    key = (request.client.host if request.client else "unknown", scope)
    now = time.monotonic()
    window = _rate_windows[key]
    while window and now - window[0] >= 60:
        window.popleft()
    if len(window) >= settings.rate_limit_per_minute:
        envelope = ErrorEnvelope(
            error=ErrorBody(
                code=ErrorCode.INVALID_PAYLOAD,
                message="请求过于频繁，请稍后重试",
                details={"reason": "rate_limited"},
            )
        )
        return JSONResponse(status_code=429, content=envelope.model_dump(mode="json"))
    window.append(now)
    return await call_next(request)


@app.exception_handler(GameError)
async def game_error_handler(_: Request, exc: GameError) -> JSONResponse:
    envelope = ErrorEnvelope(
        error=ErrorBody(code=exc.code, message=exc.message, details=exc.details)
    )
    return JSONResponse(
        status_code=HTTP_STATUS_BY_CODE[exc.code], content=envelope.model_dump(mode="json")
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
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
    return JSONResponse(status_code=422, content=envelope.model_dump(mode="json"))


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    database = await get_service().repository.health()
    return {
        "status": "ok",
        "version": settings.app_version,
        "saves": database["saves"],
        "database": database,
    }
