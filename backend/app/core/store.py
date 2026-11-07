"""会话注册表（06 §3）：内存 dict + 过期清理，单进程单实例。"""

import secrets
import time

from app.config import SimConfig
from app.core.session import GameSession
from app.sim.generator import generate_parcel

SESSION_TTL_SEC = 40 * 60  # 创建后 40 分钟无操作清除（06 §3）


class SessionRegistry:
    def __init__(self, config: SimConfig) -> None:
        self._config = config
        self._sessions: dict[str, GameSession] = {}

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
            del self._sessions[sid]

    def count(self) -> int:
        self._sweep()
        return len(self._sessions)
