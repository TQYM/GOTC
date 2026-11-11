"""市政服务（对齐 C:S 的警察 / 消防 / 垃圾 / 污水 / 电力 / 供水六条服务线）。

C:S 的市政服务是「建筑提供覆盖 → 覆盖不足产生惩罚」的闭环：
- 警察局覆盖不足 → 犯罪率上升 → 幸福下降、地价下降
- 消防局覆盖不足 → 火灾风险上升 → 建筑可能烧毁
- 垃圾场覆盖不足 → 垃圾堆积 → 污染上升
- 污水处理不足 → 水污染 → 幸福下降
- 电力不足 → 建筑无法满负荷运转 → 岗位与人口下降
- 供水不足 → 同上

CITY20 用「覆盖率」近似：每类服务建筑有一个服务半径，落在半径内的
住宅/岗位/商业地块记为该服务已覆盖。覆盖率 = 已覆盖地块 / 全部地块。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import SimConfig
from app.contracts.parcel import Parcel
from app.contracts.tile import Tile, TileType

# 服务类型 → 半径（米）/ 中文名 / 影响维度
SERVICE_SPECS: dict[TileType, dict[str, object]] = {
    TileType.SRV_POLICE: {"label": "警察局", "radius_m": 500, "metric": "police"},
    TileType.SRV_FIRE: {"label": "消防局", "radius_m": 500, "metric": "fire"},
    TileType.SRV_GARBAGE: {"label": "垃圾处理", "radius_m": 600, "metric": "garbage"},
    TileType.SRV_SEWAGE: {"label": "污水处理", "radius_m": 700, "metric": "sewage"},
    TileType.SRV_POWER: {"label": "发电厂", "radius_m": 800, "metric": "power"},
    TileType.SRV_WATER: {"label": "水厂", "radius_m": 800, "metric": "water"},
}

# 需要被服务的「消费端」地块（住宅 / 商业 / 工业）
_CONSUMER_TYPES = {
    TileType.RES_LOW,
    TileType.RES_MID,
    TileType.RES_HIGH,
    TileType.COM_SHOP,
    TileType.COM_CBD,
    TileType.IND_LIGHT,
    TileType.IND_HEAVY,
}

# 缺服务时的最大惩罚（全城 0 覆盖）
MAX_HAPPINESS_PENALTY = 8
MAX_POLLUTION_BONUS = 0.18
MAX_JOBS_PENALTY = 0.25


@dataclass(frozen=True)
class ServiceCoverage:
    police: float = 0.0
    fire: float = 0.0
    garbage: float = 0.0
    sewage: float = 0.0
    power: float = 0.0
    water: float = 0.0

    def as_dict(self) -> dict[str, float]:
        return {
            "police": self.police,
            "fire": self.fire,
            "garbage": self.garbage,
            "sewage": self.sewage,
            "power": self.power,
            "water": self.water,
        }

    @property
    def average(self) -> float:
        values = self.as_dict().values()
        return sum(values) / len(values) if values else 0.0

    def to_dict(self) -> dict[str, float]:
        return {key: round(value, 4) for key, value in self.as_dict().items()}


def _manhattan(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def service_coverage(
    parcel: Parcel, tiles: list[Tile], config: SimConfig
) -> ServiceCoverage:
    """六条服务线的覆盖率（0..1）。没有消费端地块时全部记为 1.0（空城不惩罚）。"""
    cells_per_m = 1.0 / max(1, config.cell_size_m)
    providers: dict[str, list[tuple[int, int]]] = {key: [] for key in ("police", "fire", "garbage", "sewage", "power", "water")}
    consumers: list[tuple[int, int]] = []
    for tile in tiles:
        spec = SERVICE_SPECS.get(tile.type)
        if spec is not None:
            providers[str(spec["metric"])].append((tile.anchor[0], tile.anchor[1]))
        elif tile.type in _CONSUMER_TYPES:
            consumers.append((tile.anchor[0], tile.anchor[1]))

    if not consumers:
        return ServiceCoverage(1.0, 1.0, 1.0, 1.0, 1.0, 1.0)

    result: dict[str, float] = {}
    for metric, anchors in providers.items():
        if not anchors:
            result[metric] = 0.0
            continue
        # 半径相同的服务用统一网格判断，避免逐 tile 双重循环（48×48 内很快）
        radius_cells = int(SERVICE_SPECS[_metric_type(metric)]["radius_m"] * cells_per_m)  # type: ignore[operator]
        covered = 0
        for cell in consumers:
            if any(_manhattan(cell, anchor) <= radius_cells for anchor in anchors):
                covered += 1
        result[metric] = covered / len(consumers)
    return ServiceCoverage(**result)


def _metric_type(metric: str) -> TileType:
    for tile_type, spec in SERVICE_SPECS.items():
        if spec["metric"] == metric:
            return tile_type
    raise KeyError(metric)


@dataclass(frozen=True)
class ServiceEffects:
    happiness: int
    pollution_bonus: float
    jobs_mult: float

    def to_dict(self) -> dict[str, float]:
        return {
            "happiness": self.happiness,
            "pollution_bonus": round(self.pollution_bonus, 4),
            "jobs_mult": round(self.jobs_mult, 4),
        }


def service_effects(coverage: ServiceCoverage, population: int) -> ServiceEffects:
    """把覆盖率折成三项影响：幸福、污染加成、岗位倍率。

    人口很少时不惩罚（新城刚起步，玩家还没钱修市政）。
    人口 ≥ 80 后按缺口线性放大，最差 -8 幸福 / +0.18 污染 / -25% 岗位。
    """
    if population < 80:
        return ServiceEffects(0, 0.0, 1.0)
    scale = min(1.0, (population - 80) / 400.0)
    gap = 1.0 - coverage.average
    happiness = -int(round(MAX_HAPPINESS_PENALTY * gap * scale))
    pollution = MAX_POLLUTION_BONUS * gap * scale
    dirty = 1.0 - (coverage.garbage + coverage.sewage) / 2.0
    power_gap = 1.0 - (coverage.power + coverage.water) / 2.0
    jobs_mult = 1.0 - (MAX_JOBS_PENALTY * (dirty * 0.4 + power_gap * 0.6)) * scale
    return ServiceEffects(happiness, pollution, max(0.5, jobs_mult))
