"""全局建造闸门（复刻 C:S `ZoneManager.cs:910-937`）。

C:S 每 8 帧开一次闸；开闸后扫描当前 1/1024 的区划块，最多建成 1 栋，
建成即 break，闸门关到下一个 8 帧边界。

=> 建造速率上限 = 1 栋 / 8 帧，与需求高低无关。需求只决定
   `PrivateBuildingAI` 里那一发 `randomizer.Int32(100) >= demand` 是否放行。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BuildGate:
    """每个会话一个；所有建造入口（玩家放置、AI 自发生长）共用同一道闸。"""

    open_interval: int = 8
    last_window: int = -1

    def can_build(self, frame: int) -> bool:
        """当前帧是否开闸；同一窗口只放行一次。"""
        window = frame // self.open_interval
        if window == self.last_window:
            return False
        self.last_window = window
        return True

    def consumes_build(self, frame: int) -> bool:
        """尝试消耗本窗口的唯一一次建造额度。"""
        return self.can_build(frame)

    def rate_per_year(self, frames_per_year: int) -> float:
        return frames_per_year / self.open_interval

    def snapshot(self) -> dict[str, int]:
        return {"last_window": self.last_window}

    @classmethod
    def from_snapshot(cls, data: dict[str, int]) -> "BuildGate":
        return cls(last_window=int(data.get("last_window", -1)))
