"""会话注册表（06 §3）：内存 dict + 过期清理，单进程单实例。"""

import asyncio
import secrets
import time

from app.config import SimConfig
from app.core.session import GameSession
from app.core.timer import start_heartbeat, start_timer
from app.sim.generator import generate_parcel

SESSION_TTL_SEC = 40 * 60  # 创建后 40 分钟无操作清除（06 §3）


class SessionRegistry:
    def __init__(self, config: SimConfig, enable_timer: bool = True) -> None:
        self._config = config
        self._sessions: dict[str, GameSession] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._enable_timer = enable_timer

    def create(self, seed: int | None = None) -> GameSession:
        if seed is None:
            seed = secrets.randbelow(2**31)
        parcel = generate_parcel(seed, self._config)
        session = GameSession(
            session_id="ses_" + secrets.token_hex(4),
            parcel=parcel,
            config=self._config,
        )
        self._sessions[session.session_id] = session
        if self._enable_timer:
            task = start_timer(session)
            if task is not None:
                self._tasks[session.session_id] = task
            heartbeat = start_heartbeat(session)
            if heartbeat is not None:
                self._tasks[session.session_id + ":heartbeat"] = heartbeat
        return session

    def get(self, session_id: str) -> GameSession | None:
        self._sweep()
        session = self._sessions.get(session_id)
        if session is not None:
            session.last_active = time.monotonic()
        return session

    def _sweep(self) -> None:
        now = time.monotonic()
        dead = [
            sid
            for sid, s in self._sessions.items()
            if now - s.last_active > SESSION_TTL_SEC
        ]
        for sid in dead:
            self._sessions[sid].closed = True
            task = self._tasks.pop(sid, None)
            if task is not None:
                task.cancel()
            del self._sessions[sid]

    def close(self) -> None:
        """取消全部计时任务（测试/进程退出）。"""
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
        for session in self._sessions.values():
            session.closed = True

    def active_sessions(self) -> list[GameSession]:
        """供 mentor 调度等遍历（未关闭会话）。"""
        return [session for session in self._sessions.values() if not session.closed]

    def count(self) -> int:
        self._sweep()
        return len(self._sessions)
