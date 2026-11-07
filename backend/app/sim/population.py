"""人口与住宅吸引力（03 §4.2）。

每座住宅：容量 × min(1, 吸引力)，再按全城 Σ容量×0.95 等比封顶。
吸引力各系数为本模块常量（03 §8 未列入配置表，调参需同步文档）。
"""

from dataclasses import dataclass

from app.config import SimConfig
from app.contracts.parcel import Parcel, Terrain
from app.contracts.tile import Tile, TileType

# 吸引力系数（03 §4.2）
PARK_BONUS = 0.10  # 500m 内每个公园
SCHOOL_BONUS = 0.08  # 800m 内每所学校
CLINIC_BONUS = 0.08  # 800m 内每所医院
HEAVY_PENALTY = 0.15  # 300m 内有重工业（布尔）
HILL_PENALTY = 0.05  # 位于丘陵
OCCUPANCY_CAP = 0.95  # 全城入住 ≤ Σ容量×0.95

RES_TYPES = {TileType.RES_LOW, TileType.RES_MID, TileType.RES_HIGH}


def manhattan(a: list[int], b: list[int]) -> int:
    """锚点格之间的曼哈顿距离（03 §4 符号约定）。"""
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def capacity_of(tile_type: TileType, config: SimConfig) -> int:
    res = config.residential
    return {
        TileType.RES_LOW: res.capacity_res_low,
        TileType.RES_MID: res.capacity_res_mid,
        TileType.RES_HIGH: res.capacity_res_high,
    }[tile_type]


@dataclass(frozen=True)
class ResStat:
    """单座住宅的统计量（地价/污染/覆盖率模块复用）。"""

    tile_id: str
    anchor: tuple[int, int]
    capacity: int
    attraction: float
    occupancy: float  # 封顶缩放后的实际入住


def residential_stats(
    parcel: Parcel, tiles: list[Tile], config: SimConfig
) -> list[ResStat]:
    """逐住宅算吸引力与入住，再按全城容量上限等比缩放。"""
    cell = config.cell_size_m
    parks = [t.anchor for t in tiles if t.type is TileType.GREEN_PARK]
    schools = [t.anchor for t in tiles if t.type is TileType.EDU_SCHOOL]
    clinics = [t.anchor for t in tiles if t.type is TileType.MED_CLINIC]
    heavies = [t.anchor for t in tiles if t.type is TileType.IND_HEAVY]

    stats: list[ResStat] = []
    for tile in tiles:
        if tile.type not in RES_TYPES:
            continue
        cap = capacity_of(tile.type, config)
        a = tile.anchor
        attraction = 1.0
        attraction += PARK_BONUS * sum(1 for p in parks if manhattan(a, p) <= 500 // cell)
        attraction += SCHOOL_BONUS * sum(1 for s in schools if manhattan(a, s) <= 800 // cell)
        attraction += CLINIC_BONUS * sum(1 for c in clinics if manhattan(a, c) <= 800 // cell)
        if any(manhattan(a, h) <= 300 // cell for h in heavies):
            attraction -= HEAVY_PENALTY
        if parcel.terrain[a[0]][a[1]] is Terrain.HILL:
            attraction -= HILL_PENALTY
        stats.append(
            ResStat(
                tile_id=tile.id,
                anchor=(a[0], a[1]),
                capacity=cap,
                attraction=attraction,
                occupancy=cap * min(1.0, attraction),
            )
        )

    total_cap = sum(s.capacity for s in stats)
    total_occ = sum(s.occupancy for s in stats)
    if total_occ > 0:
        scale = min(1.0, total_cap * OCCUPANCY_CAP / total_occ)
        stats = [
            ResStat(s.tile_id, s.anchor, s.capacity, s.attraction, s.occupancy * scale)
            for s in stats
        ]
    return stats


def population_of(stats: list[ResStat]) -> int:
    """population = Σ实际入住，取整（03 §4.2；round 避免浮点 0.7999…×900 截断误差）。"""
    return round(sum(s.occupancy for s in stats))
