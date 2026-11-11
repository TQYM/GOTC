"""城市级政策（对齐 C:S 的 Policies 面板：全城开关，不是分区）。

C:S 的城市政策和区政策是两套东西：
- 区政策（`DistrictPolicies`）只作用于该区，靠位标志；
- 城市政策（`CityPolicies`）作用于全城，成本体现在预算里。

CITY20 的区政策已经在 `districts.py`；这里是全城那一套。
所有效果都乘进 `engine.recompute`，并且**必须有成本**——C:S 里没有免费的政策。
"""

from __future__ import annotations

from dataclasses import dataclass

CITY_POLICIES: dict[str, dict] = {
    "free_transit": {
        "label": "免费公交",
        "hint": "通勤吸引力 +10%，公交票价收入归零",
        "commute_mult": 0.90,
        "transit_income_mult": 0.0,
        "upkeep_mult": 1.04,
    },
    "smoke_ban": {
        "label": "公共场所禁烟",
        "hint": "幸福 +5，商业税收 -3%",
        "happiness": 5,
        "tax_mult": 0.97,
    },
    "recycling": {
        "label": "垃圾分类",
        "hint": "污染 -15%，维护费 +5%",
        "pollution_mult": 0.85,
        "upkeep_mult": 1.05,
    },
    "ev_mandate": {
        "label": "电动化强制",
        "hint": "污染 -10%，维护费 +3%",
        "pollution_mult": 0.90,
        "upkeep_mult": 1.03,
    },
    "night_budget": {
        "label": "夜间预算削减",
        "hint": "夜间维护费 -12%，幸福 -3",
        "night_upkeep_mult": 0.88,
        "happiness": -3,
    },
}


@dataclass(frozen=True)
class PolicyEffects:
    commute_mult: float = 1.0
    pollution_mult: float = 1.0
    upkeep_mult: float = 1.0
    tax_mult: float = 1.0
    transit_income_mult: float = 1.0
    happiness: int = 0

    def to_dict(self) -> dict:
        return {
            "commute_mult": round(self.commute_mult, 4),
            "pollution_mult": round(self.pollution_mult, 4),
            "upkeep_mult": round(self.upkeep_mult, 4),
            "tax_mult": round(self.tax_mult, 4),
            "transit_income_mult": round(self.transit_income_mult, 4),
            "happiness": self.happiness,
        }


def policy_effects(active: set[str] | list[str]) -> PolicyEffects:
    """把一组政策乘起来。未知名直接忽略（旧存档兼容）。"""
    commute = 1.0
    pollution = 1.0
    upkeep = 1.0
    tax = 1.0
    transit_income = 1.0
    happiness = 0
    for key in active:
        spec = CITY_POLICIES.get(key)
        if spec is None:
            continue
        commute *= float(spec.get("commute_mult", 1.0))
        pollution *= float(spec.get("pollution_mult", 1.0))
        upkeep *= float(spec.get("upkeep_mult", 1.0))
        tax *= float(spec.get("tax_mult", 1.0))
        transit_income *= float(spec.get("transit_income_mult", 1.0))
        happiness += int(spec.get("happiness", 0))
    return PolicyEffects(
        commute_mult=commute,
        pollution_mult=pollution,
        upkeep_mult=upkeep,
        tax_mult=tax,
        transit_income_mult=transit_income,
        happiness=happiness,
    )


def policy_list(active: set[str] | list[str]) -> list[dict]:
    """给 UI：全部政策 + 是否启用。"""
    chosen = set(active)
    return [
        {
            "key": key,
            "label": spec["label"],
            "hint": spec["hint"],
            "enabled": key in chosen,
        }
        for key, spec in CITY_POLICIES.items()
    ]
