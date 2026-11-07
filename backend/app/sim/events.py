"""环境事件池（03 §7）：每年末 5% 概率；数值影响由引擎执行，文案由叙述层生成。

确定性：随机源 = random.Random(f"city20:{seed}:event:{year}")（03 §1）。
"""

import random
from dataclasses import dataclass

TRIGGER_PROBABILITY = 0.05

FLOOD = "flood"  # 暴雨内涝：当年 upkeep +15%
BOOM = "industry_boom"  # 产业风口：当年岗位税 +20%
VIRAL = "viral_spot"  # 网红打卡：地价 +5 持续 1 年
FOREST_PROTEST = "forest_protest"  # 铲过 forest 才可能出现：happiness −5 一年

EVENT_LABELS = {
    FLOOD: "暴雨内涝",
    BOOM: "产业风口",
    VIRAL: "网红打卡",
    FOREST_PROTEST: "林地抗议",
}


@dataclass(frozen=True)
class EventModifier:
    """一年期数值修正，由 engine.recompute 消费。"""

    upkeep_mult: float = 1.0
    job_tax_mult: float = 1.0
    land_bonus: float = 0.0
    happiness_delta: float = 0.0


MODIFIERS = {
    FLOOD: EventModifier(upkeep_mult=1.15),
    BOOM: EventModifier(job_tax_mult=1.20),
    VIRAL: EventModifier(land_bonus=5.0),
    FOREST_PROTEST: EventModifier(happiness_delta=-5.0),
}


def roll_event(seed: int, year: int, cleared_forest: bool) -> str | None:
    """每年末 5% 概率抽一条；未铲森林时 protest 不在池内（03 §7）。"""
    rng = random.Random(f"city20:{seed}:event:{year}")
    if rng.random() >= TRIGGER_PROBABILITY:
        return None
    pool = [FLOOD, BOOM, VIRAL] + ([FOREST_PROTEST] if cleared_forest else [])
    return pool[rng.randrange(len(pool))]


def modifier_for(event_id: str | None) -> EventModifier:
    return MODIFIERS.get(event_id, EventModifier())
