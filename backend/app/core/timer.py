"""阶段调度器（06 §2）：每会话一个异步任务，每秒驱动 GameSession.timer_tick。

只在有运行中事件循环时启动（uvicorn / TestClient）；纯同步单测不启动，
阶段推进由测试直接调 timer_tick 验证。会话被清扫（closed）或 finalize 后退出。
"""

import asyncio
import logging

from app.core.session import GameSession

log = logging.getLogger(__name__)
TICK_INTERVAL_SEC = 1.0


async def session_timer(session: GameSession) -> None:
    try:
        while not session.closed and not session.finalized:
            await asyncio.sleep(TICK_INTERVAL_SEC)
            async with session.lock:
                session.timer_tick()
    except asyncio.CancelledError:
        raise
    except Exception:  # 计时器异常不应拖垮服务；会话仍可手动操作
        log.exception("session %s timer failed", session.session_id)


def start_timer(session: GameSession) -> asyncio.Task | None:
    """在运行中的事件循环里启动计时任务；无循环（同步测试）返回 None。"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    return loop.create_task(session_timer(session))
