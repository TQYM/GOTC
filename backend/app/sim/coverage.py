"""公共服务覆盖率（03 §4.13）：600m（12 格曼哈顿）内有学校/医院的住宅入住占比。"""

from app.config import SimConfig
from app.contracts.tile import Tile, TileType
from app.sim.population import ResStat, manhattan

COVERAGE_RADIUS_M = 600


def coverage(
    stats: list[ResStat], tiles: list[Tile], config: SimConfig
) -> tuple[float, float]:
    total_occ = sum(s.occupancy for s in stats)
    if total_occ <= 0:
        return 0.0, 0.0
    radius = COVERAGE_RADIUS_M // config.cell_size_m
    schools = [t.anchor for t in tiles if t.type is TileType.EDU_SCHOOL]
    clinics = [t.anchor for t in tiles if t.type is TileType.MED_CLINIC]
    edu_occ = med_occ = 0.0
    for s in stats:
        a = list(s.anchor)
        if any(manhattan(a, sc) <= radius for sc in schools):
            edu_occ += s.occupancy
        if any(manhattan(a, cl) <= radius for cl in clinics):
            med_occ += s.occupancy
    return round(edu_occ / total_occ, 4), round(med_occ / total_occ, 4)
