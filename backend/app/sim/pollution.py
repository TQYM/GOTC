"""污染（03 §4.9）：工业源按曼哈顿距离线性衰减，住宅入住加权暴露。"""

from app.config import SimConfig
from app.contracts.parcel import Parcel
from app.contracts.tile import Tile, TileType
from app.sim.population import ResStat

NO_RESIDENCE_FACTOR = 0.25  # 无住宅时：全城格简单平均 × 1/4（03 §4.9）


def pollution_map(
    parcel: Parcel, tiles: list[Tile], config: SimConfig
) -> dict[tuple[int, int], float]:
    """稀疏污染格图：Σ源 max(0, 强度 − 衰减×d(格, 源锚点))，上限 1。"""
    pc = config.pollution
    sources = [
        (t.anchor, pc.pollution_heavy if t.type is TileType.IND_HEAVY else pc.pollution_light)
        for t in tiles
        if t.type in (TileType.IND_HEAVY, TileType.IND_LIGHT)
    ]
    result: dict[tuple[int, int], float] = {}
    for (ar, ac), strength in sources:
        reach = int(strength / pc.pollution_decay)  # 衰减到 0 的格距
        for r in range(max(0, ar - reach), min(parcel.size, ar + reach + 1)):
            for c in range(max(0, ac - reach), min(parcel.size, ac + reach + 1)):
                d = abs(r - ar) + abs(c - ac)
                if d > reach:
                    continue
                value = max(0.0, strength - pc.pollution_decay * d)
                key = (r, c)
                result[key] = min(1.0, result.get(key, 0.0) + value)
    return result


def city_pollution(
    parcel: Parcel, tiles: list[Tile], stats: list[ResStat], config: SimConfig
) -> float:
    """全城污染：住宅格暴露按入住加权；无住宅时全格简单平均 ×1/4。"""
    pmap = pollution_map(parcel, tiles, config)
    total_occ = sum(s.occupancy for s in stats)
    if total_occ > 0:
        weighted = sum(pmap.get(s.anchor, 0.0) * s.occupancy for s in stats)
        return round(weighted / total_occ, 4)
    mean = sum(pmap.values()) / (parcel.size * parcel.size)
    return round(mean * NO_RESIDENCE_FACTOR, 4)
