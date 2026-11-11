"""RCI 需求双轨（复刻 C:S ZoneManager 的 actual / displayed 分离）。

C:S 同时维护两套需求值：
- `m_actualResidentialDemand` 等：真值，驱动 zoning 概率
- `m_residentialDemand` 等：显示值，喂 UI 需求条

两者不同步，玩家看到的需求条滞后于真实判定。CITY20 复刻这个分层：
`actual_*` 决定这一栋能不能过概率，`displayed_*` 只喂界面。
"""

from __future__ import annotations

from dataclasses import dataclass

# 显示值每帧向真值靠拢的比例；10 帧基本收敛，对应 C:S 每 8 帧同步一次。
DISPLAY_SMOOTHING = 0.10

# 每居民对应的商业容量当量（用于把人口换算成「需要的商业面积」）。
COMMERCIAL_PER_CAPITA = 0.22


def _clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


@dataclass
class Demand:
    """三维需求，真值与显示值成对存在。"""

    actual_residential: float = 0.0
    actual_commercial: float = 0.0
    actual_workplace: float = 0.0
    displayed_residential: float = 0.0
    displayed_commercial: float = 0.0
    displayed_workplace: float = 0.0

    def recompute(
        self,
        *,
        population: int,
        housing_capacity: int,
        jobs: int,
        workforce: int,
        commercial_capacity: int,
        office_capacity: int = 0,
    ) -> None:
        """按供需缺口重算真值，值域 -1..1（正=缺，负=过剩）。"""
        # 住宅：空置率（C:S 语义 —— 住房越空，移民需求越高；满员转负）
        if housing_capacity > 0:
            self.actual_residential = _clamp(
                1.0 - population / housing_capacity
            )
        else:
            # 空城给满住宅需求：C:S 的新城初始需求为正，否则永远长不出第一栋。
            self.actual_residential = 1.0

        # 商业：居民消费需求相对商业容量的缺口
        needed_commercial = population * COMMERCIAL_PER_CAPITA
        if commercial_capacity > 0:
            self.actual_commercial = _clamp(
                (needed_commercial - commercial_capacity) / commercial_capacity
            )
        else:
            # 空城给半格需求：C:S 的新城商业需求同样为正，否则商铺永远等不到第一栋。
            self.actual_commercial = 1.0 if needed_commercial > 0 else 0.5

        # 办公：劳动力相对岗位（含办公容量）的缺口
        total_jobs = jobs + office_capacity
        if total_jobs > 0:
            self.actual_workplace = _clamp((workforce - total_jobs) / total_jobs)
        else:
            self.actual_workplace = 1.0 if workforce > 0 else 0.3

    def smooth(self, factor: float = DISPLAY_SMOOTHING) -> None:
        """把显示值向真值靠拢一帧。"""
        self.displayed_residential += (
            self.actual_residential - self.displayed_residential
        ) * factor
        self.displayed_commercial += (
            self.actual_commercial - self.displayed_commercial
        ) * factor
        self.displayed_workplace += (
            self.actual_workplace - self.displayed_workplace
        ) * factor

    @staticmethod
    def to_ui(value: float) -> int:
        """-1..1 映射到需求条的 0..100。"""
        return max(0, min(100, round((value + 1.0) * 50.0)))

    def snapshot(self) -> dict[str, float]:
        return {
            "actual_residential": self.actual_residential,
            "actual_commercial": self.actual_commercial,
            "actual_workplace": self.actual_workplace,
            "displayed_residential": self.displayed_residential,
            "displayed_commercial": self.displayed_commercial,
            "displayed_workplace": self.displayed_workplace,
        }

    @classmethod
    def from_snapshot(cls, data: dict[str, float]) -> "Demand":
        return cls(**{k: float(v) for k, v in data.items() if k in cls.__annotations__})
