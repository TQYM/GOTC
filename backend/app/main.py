"""FastAPI 入口：挂路由、中间件、异常处理器（06 §2）。

PR-01 仅落地应用骨架与健康检查端点；REST 路由在 PR-03 接入。
"""

from fastapi import FastAPI

from app.config import Settings

settings = Settings()

app = FastAPI(title="CITY20 Backend", version=settings.app_version)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """进程存活探活（06 §7）。"""
    return {"status": "ok", "version": settings.app_version}
