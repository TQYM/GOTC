"""地价指数（03 §4.5）：逐住宅算地价，按入住加权全城平均。"""

from app.config import SimConfig
from app.contracts.parcel import Parcel, Terrain
from app.contracts.tile import Tile, TileType
from app.sim.population import ResStat, manhattan

# 地价修正系数（03 §4.5）
CBD_BONUS = 8  # 400m 内每个商务中心
SHOP_BONUS = 3  # 400m 内每个社区商业
METRO_BONUS = 6  # 600m 内每个地铁站
PLAZA_BONUS = 5  # 300m 内每个城市广场
PARK_BONUS = 1  # 300m 内每个公园
HEAVY_PENALTY = 10  # 500m 内每个重工业
LIGHT_PENALTY = 4  # 500m 内每个轻工业
BANK_BONUS = 10  # 河景（锚点在 bank；bank 仅绿地可建，正常布局下不触发）
HILL_PENALTY = 8  # 位于丘陵
BASE_INDEX = 100.0


def residential_land_price(
    parcel: Parcel, tiles: list[Tile], anchor: tuple[int, int], config: SimConfig
) -> float:
    cell = config.cell_size_m
    a = list(anchor)
    price = BASE_INDEX
    for tile in tiles:
        d = manhattan(a, tile.anchor)
        t = tile.type
        if t is TileType.COM_CBD and d <= 400 // cell:
            price += CBD_BONUS
        elif t is TileType.COM_SHOP and d <= 400 // cell:
            price += SHOP_BONUS
        elif t is TileType.TRANS_METRO and d <= 600 // cell:
            price += METRO_BONUS
        elif t is TileType.GREEN_PLAZA and d <= 300 // cell:
            price += PLAZA_BONUS
        elif t is TileType.GREEN_PARK and d <= 300 // cell:
            price += PARK_BONUS
        elif t is TileType.IND_HEAVY and d <= 500 // cell:
            price -= HEAVY_PENALTY
        elif t is TileType.IND_LIGHT and d <= 500 // cell:
            price -= LIGHT_PENALTY
    terrain = parcel.terrain[a[0]][a[1]]
    if terrain is Terrain.BANK:
        price += BANK_BONUS
    elif terrain is Terrain.HILL:
        price -= HILL_PENALTY
    return price


def land_price_index(
    parcel: Parcel, tiles: list[Tile], stats: list[ResStat], config: SimConfig
) -> float:
    """全城指数 = Σ(住宅地价×入住) ÷ Σ入住，1 位小数；无住宅/无入住 = 100。"""
    total_occ = sum(s.occupancy for s in stats)
    if total_occ <= 0:
        return BASE_INDEX
    by_id = {s.tile_id: s for s in stats}
    weighted = 0.0
    for tile in tiles:
        s = by_id.get(tile.id)
        if s is None:
            continue
        weighted += residential_land_price(parcel, tiles, s.anchor, config) * s.occupancy
    return round(weighted / total_occ, 1)
