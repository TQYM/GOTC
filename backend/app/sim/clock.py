"""C:S 风格帧时钟。

结构复刻自 Cities: Skylines 1 的 `SimulationManager.SimulationStep`
（`~/reverse/cities-skylines/decompiled/Assembly-CSharp/SimulationManager.cs:869-960`）：

- 唯一时间单位是 frame（整数）；年、日、小时全部由 frame 派生，不独立累加
- 速度档 0/1/2/3 分别对应每 tick 跑 0/1/2/4 帧（C:S 的 3x 档实际跑 4 帧）
- 暂停时仍返回 subStep=0：管理器照跑脏队列，但 frame 不前进
- speed>0 时 subStep 从 1 开始（C:S `int num = (finalSimulationSpeed != 0) ? 1 : 0`）

C:S 原始尺度是 585.14 帧/日、213,576 帧/年；CITY20 一局只有约 300 秒/年，
因此保留结构、压缩常数：10 帧/日、3,600 帧/年。
"""

from __future__ import annotations

from dataclasses import dataclass

# 速度档 → 每 tick 实际帧数。3 档刻意跑 4 帧，与 C:S 一致。
SPEED_FRAMES: dict[int, int] = {0: 0, 1: 1, 2: 2, 3: 4}

FRAMES_PER_DAY = 10
FRAMES_PER_YEAR = 3_600
DAYS_PER_YEAR = 365


@dataclass
class SimulationClock:
    """会话级帧时钟。所有模拟系统只读它，不自己累加时间。"""

    frames_per_year: int = FRAMES_PER_YEAR
    frames_per_day: int = FRAMES_PER_DAY
    frame: int = 0
    speed: int = 1

    @property
    def final_speed(self) -> int:
        """映射后的每 tick 帧数；未知档位按 1x 处理。"""
        return SPEED_FRAMES.get(self.speed, 1)

    @property
    def paused(self) -> bool:
        return self.final_speed == 0

    def sub_steps(self) -> list[int]:
        """本 tick 要执行的 subStep 序列（C:S 语义：0 只在暂停时出现）。"""
        n = self.final_speed
        if n == 0:
            return [0]
        return list(range(1, n + 1))

    def advance(self) -> list[int]:
        """推进一个 tick，每个非零 subStep 推进一帧。返回本 tick 的 subStep 序列。"""
        steps = self.sub_steps()
        for step in steps:
            if step != 0:
                self.frame += 1
        return steps

    @property
    def year(self) -> int:
        return self.frame // self.frames_per_year + 1

    @property
    def day(self) -> int:
        return self.frame // self.frames_per_day + 1

    @property
    def day_of_year(self) -> int:
        return (self.frame // self.frames_per_day) % DAYS_PER_YEAR + 1

    @property
    def hour(self) -> float:
        return (self.frame % self.frames_per_day) / self.frames_per_day * 24.0

    @property
    def is_night(self) -> bool:
        return self.hour < 5.0 or self.hour > 20.0

    def snapshot(self) -> dict[str, int]:
        return {"frame": self.frame, "speed": self.speed}

    @classmethod
    def from_snapshot(cls, data: dict[str, int]) -> "SimulationClock":
        return cls(frame=int(data.get("frame", 0)), speed=int(data.get("speed", 1)))
