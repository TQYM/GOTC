"""灾难（对齐 C:S 的 DisasterManager：火灾 / 内涝 / 陨石）。

C:S 的灾难不是纯随机：它由城市的**防灾能力**调制。
- 消防覆盖低 → 火灾概率高
- 河道附近 + 排水不足 → 内涝概率高
- 陨石极低概率，纯随机（C:S 里也是）
- 灾难发生时：建筑烧毁、幸福骤降、新闻播报

CITY20 用确定性哈希（seed + year + kind）保证 replay 一致——
这与市民生命周期用的是同一套原则：**同样的输入必须得到同样的结果**。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

DISASTER_LABELS: dict[str, str] = {
    "fire": "火灾",
    "flood": "内涝",
    "meteor": "陨石",
}

# 基础年概率
FIRE_BASE = 0.06
FLOOD_BASE = 0.04
METEOR_BASE = 0.002

# 幸福冲击
DISASTER_HAPPINESS: dict[str, int] = {"fire": -6, "flood": -8, "meteor": -12}


def _unit(*parts: object) -> float:
    raw = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.blake2b(raw, digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64


@dataclass(frozen=True)
class DisasterResult:
    kind: str
    tile_id: str | None
    destroyed: bool
    happiness: int

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "label": DISASTER_LABELS.get(self.kind, self.kind),
            "tile_id": self.tile_id,
            "destroyed": self.destroyed,
            "happiness": self.happiness,
        }


def roll_disaster(
    seed: int,
    year: int,
    *,
    fire_coverage: float,
    river_near: bool,
    candidates: list[str],
    density: float,
) -> DisasterResult | None:
    """每年判定一次。`candidates` 是可能被摧毁的建筑 tile id。

    概率设计（对齐 C:S 的「防灾投资降低损失」）：
    - 火灾：`0.06 * (1 - fire_coverage) * (0.5 + density)`
    - 内涝：`0.04`（仅临河），排水覆盖越低越高
    - 陨石：`0.002`，纯随机
    """
    if not candidates:
        return None

    fire_p = FIRE_BASE * (1.0 - min(1.0, fire_coverage)) * (0.5 + min(1.0, density))
    if _unit("disaster", seed, year, "fire") < fire_p:
        victim = candidates[int(_unit("victim", seed, year, "fire") * len(candidates)) % len(candidates)]
        return DisasterResult("fire", victim, True, DISASTER_HAPPINESS["fire"])

    if river_near and _unit("disaster", seed, year, "flood") < FLOOD_BASE:
        victim = candidates[int(_unit("victim", seed, year, "flood") * len(candidates)) % len(candidates)]
        return DisasterResult("flood", victim, True, DISASTER_HAPPINESS["flood"])

    if _unit("disaster", seed, year, "meteor") < METEOR_BASE:
        victim = candidates[int(_unit("victim", seed, year, "meteor") * len(candidates)) % len(candidates)]
        return DisasterResult("meteor", victim, True, DISASTER_HAPPINESS["meteor"])

    return None
