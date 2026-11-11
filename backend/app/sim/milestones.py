"""里程碑（对齐 C:S 的人口里程碑：城市规模决定解锁档位）。

C:S 的里程碑不是「任务」，而是**规模门槛**：人口到 500 解锁中级区划、
到 2000 解锁高密、到 8000 解锁地标……玩家看到的是「下一档还差多少人」。

CITY20 保留这个形状，但解锁的是地块类型与政策，不做硬校验
（硬校验会让老存档里的高密建筑突然非法，C:S 也是靠「已建的不拆」避免这个）。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.contracts.tile import TileType


@dataclass(frozen=True)
class Milestone:
    tier: int
    population: int
    label: str
    unlocks: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "tier": self.tier,
            "population": self.population,
            "label": self.label,
            "unlocks": list(self.unlocks),
        }


MILESTONES: tuple[Milestone, ...] = (
    Milestone(1, 0, "村庄", ("res_low", "com_shop", "ind_light", "trans_road")),
    Milestone(2, 300, "集镇", ("res_mid", "com_cbd", "ind_heavy", "edu_school")),
    Milestone(3, 1500, "小城", ("res_high", "med_clinic", "trans_avenue", "srv_police")),
    Milestone(4, 5000, "城市", ("trans_metro", "trans_highway", "srv_fire", "srv_garbage")),
    Milestone(5, 12000, "大都会", ("srv_sewage", "srv_power", "srv_water")),
)


def milestone_of(population: int) -> Milestone:
    """当前档位：人口跨过门槛即升档。"""
    current = MILESTONES[0]
    for milestone in MILESTONES:
        if population >= milestone.population:
            current = milestone
        else:
            break
    return current


def next_milestone(population: int) -> Milestone | None:
    for milestone in MILESTONES:
        if population < milestone.population:
            return milestone
    return None


def milestone_view(population: int) -> dict:
    current = milestone_of(population)
    upcoming = next_milestone(population)
    if upcoming is None:
        return {
            **current.to_dict(),
            "next": None,
            "progress": 1.0,
        }
    span = max(1, upcoming.population - current.population)
    progress = (population - current.population) / span
    return {
        **current.to_dict(),
        "next": upcoming.to_dict(),
        "progress": round(max(0.0, min(1.0, progress)), 4),
    }


__all__ = ["MILESTONES", "Milestone", "TileType", "milestone_of", "milestone_view", "next_milestone"]
