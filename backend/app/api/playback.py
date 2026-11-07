"""推演播放（02 §3.8）：projection_step 每约 3.5s 一年 → report_ready → report 阶段。

只播放 finalize 时已计算的切片；AI 报告失败落模板，绝不阻塞数值流程。
REST finalize 与 polish 超时自动 finalize 都经 ensure_playback 幂等触发。
"""

import asyncio
import logging

from app.contracts.events import PhaseChangeEvent, ProjectionStep, ReportReadyEvent
from app.contracts.metrics import Phase
from app.core.session import GameSession
from app.narrate.router import Narrator

log = logging.getLogger(__name__)
PROJECTION_STEP_SEC = 3.5  # 02 §3.8：每约 3.5 秒发布一年


async def run_playback(
    session: GameSession, narrator: Narrator, step_sec: float = PROJECTION_STEP_SEC
) -> None:
    result = session.finalize_result
    if result is None:
        return
    try:
        for slice_ in result.projection:
            step = ProjectionStep(
                year=slice_.year, metrics=slice_.metrics, events=slice_.events, source=slice_.source
            )
            session._log_event("projection_step", step.model_dump(mode="json"))
            session.projection_published_year = slice_.year
            await asyncio.sleep(step_sec)
        report = await narrator.ai_report(session, result)  # 20s 超时/失败 → None
        if report is not None:
            session.finalize_result = result.model_copy(update={"report": report})
        else:
            report = result.report  # 模板报告（finalize 时已生成）
        session._log_event(
            "report_ready",
            ReportReadyEvent(
                report=report, city_name=result.city_name, source=report.source
            ).model_dump(mode="json"),
        )
        session.phase = Phase.REPORT
        session._log_event(
            "phase_change",
            PhaseChangeEvent(phase=Phase.REPORT, time_left_sec=0).model_dump(mode="json"),
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("projection playback failed: %s", session.session_id)


def ensure_playback(
    session: GameSession, narrator: Narrator, step_sec: float = PROJECTION_STEP_SEC
) -> asyncio.Task | None:
    """幂等启动播放任务；同步上下文返回 None（测试用 run_playback 直接驱动）。"""
    if not session.finalized or session.projection_playback_started:
        return None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    session.projection_playback_started = True
    return loop.create_task(run_playback(session, narrator, step_sec))
