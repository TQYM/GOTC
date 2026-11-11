"""建筑等级升级：地价推着低层住宅翻新（C:S 的 level up）。"""

from app.config import load_sim_config
from app.contracts.metrics import Phase
from app.contracts.tile import TileType
from app.core.city import CityState
from app.sim.generator import generate_parcel

SEED = 882314


def _state() -> CityState:
    config = load_sim_config()
    parcel = generate_parcel(SEED, config)
    return CityState("s1", parcel, config, phase=Phase.BUILDING, funds=9_000_000)


def test_low_rises_to_mid_when_land_price_is_high() -> None:
    state = _state()
    for r in range(8, 11):
        state.place(TileType.RES_LOW, [r, 8])
    assert len(state.tiles) >= 3
    for tile_id in list(state.tiles):
        state.built[tile_id] = 1.0
    # 直接把地价顶到高位，模拟「公园/学校铺满后的成熟片区」
    state.metrics = state.metrics.model_copy(update={"land_price_index": 95})

    for frame in range(1024, 1024 * 70, 1024):
        state._try_upgrade(frame)

    types = {tile.type for tile in state.tiles.values()}
    assert TileType.RES_MID in types or TileType.RES_HIGH in types


def test_no_upgrade_below_price_threshold() -> None:
    state = _state()
    state.place(TileType.RES_LOW, [8, 8])
    for tile_id in list(state.tiles):
        state.built[tile_id] = 1.0
    state.metrics = state.metrics.model_copy(update={"land_price_index": 30})
    before = {tile.id: tile.type for tile in state.tiles.values()}

    for frame in range(1024, 1024 * 70, 1024):
        state._try_upgrade(frame)

    assert {tile.id: tile.type for tile in state.tiles.values()} == before


def test_unbuilt_lots_do_not_upgrade() -> None:
    state = _state()
    state.place(TileType.RES_LOW, [8, 8])
    for tile_id in list(state.tiles):
        state.built[tile_id] = 0.0
    state.metrics = state.metrics.model_copy(update={"land_price_index": 99})
    before = {tile.id: tile.type for tile in state.tiles.values()}

    for frame in range(1024, 1024 * 70, 1024):
        state._try_upgrade(frame)

    assert {tile.id: tile.type for tile in state.tiles.values()} == before


def test_upgrade_raises_capacity_of_the_lot() -> None:
    state = _state()
    state.place(TileType.RES_LOW, [8, 8])
    tile = next(iter(state.tiles.values()))
    low_capacity = state._stats_with_actual_occupancy()[0].capacity
    tile.type = TileType.RES_MID
    state._targets_dirty = True
    mid_capacity = state._stats_with_actual_occupancy()[0].capacity
    assert mid_capacity > low_capacity
