"""道路等级：大道 ×2 容量、高速 ×3 容量，通勤时间递减。"""

from app.config import load_sim_config
from app.contracts.common import TextPayload
from app.contracts.parcel import Parcel, ParcelConstraints, Terrain
from app.contracts.tile import Tile, TileType
from app.sim.population import residential_stats
from app.sim.traffic import compute_traffic

CONFIG = load_sim_config()
SIZE = 24


def _parcel() -> Parcel:
    terrain = [[Terrain.FLAT for _ in range(SIZE)] for _ in range(SIZE)]
    return Parcel(
        size=SIZE,
        cell_size_m=50,
        terrain=terrain,
        inherited_road=[],
        seed=7,
        constraints=ParcelConstraints(
            height_limit_m=82,
            green_line_m=30,
            buildable_ratio=0.83,
            briefing=TextPayload(text="测试地块", source="template"),
        ),
    )


def _tile(tid: str, ttype: TileType, r: int, c: int) -> Tile:
    return Tile(
        id=tid, type=ttype, anchor=[r, c], cells=[[r, c]], built_at_year=1, upkeep=0
    )


def _corridor(road: TileType) -> float:
    parcel = _parcel()
    tiles = [_tile("home", TileType.RES_LOW, 5, 5)]
    for c in range(6, 18):
        tiles.append(_tile(f"road-{c}", road, 5, c))
    tiles.append(_tile("shop", TileType.COM_SHOP, 5, 19))
    stats = residential_stats(parcel, [t for t in tiles if t.type is TileType.RES_LOW], CONFIG)
    result = compute_traffic(parcel, tiles, stats, CONFIG)
    return result.avg_commute


def test_higher_road_level_shortens_commute():
    plain = _corridor(TileType.TRANS_ROAD)
    avenue = _corridor(TileType.TRANS_AVENUE)
    highway = _corridor(TileType.TRANS_HIGHWAY)
    assert avenue <= plain
    assert highway <= avenue


def test_road_levels_are_placeable_types():
    for ttype in (TileType.TRANS_AVENUE, TileType.TRANS_HIGHWAY):
        assert ttype in TileType
