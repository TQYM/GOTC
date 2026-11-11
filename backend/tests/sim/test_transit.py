"""公共交通线路：建线、加站、票价、通勤替代效应、快照往返。"""

import pytest

from app.config import load_sim_config
from app.contracts.common import TextPayload
from app.contracts.parcel import Parcel, ParcelConstraints, Terrain
from app.contracts.tile import Tile, TileType
from app.core.city import CityState
from app.sim.population import residential_stats
from app.sim.traffic import compute_traffic
from app.sim.transit import LINE_KINDS, TransitManager

CONFIG = load_sim_config()
SIZE = 48


def _parcel() -> Parcel:
    terrain = [[Terrain.FLAT for _ in range(SIZE)] for _ in range(SIZE)]
    return Parcel(
        size=SIZE,
        cell_size_m=50,
        terrain=terrain,
        inherited_road=[],
        seed=11,
        constraints=ParcelConstraints(
            height_limit_m=82,
            green_line_m=30,
            buildable_ratio=0.83,
            briefing=TextPayload(text="测试地块", source="template"),
        ),
    )


def _tile(tid: str, ttype: TileType, r: int, c: int) -> Tile:
    return Tile(id=tid, type=ttype, anchor=[r, c], cells=[[r, c]], built_at_year=1, upkeep=0)


def _city(tiles: list[Tile]) -> CityState:
    from app.contracts.metrics import Phase

    city = CityState("T", _parcel(), CONFIG, phase=Phase.BUILDING, funds=1_000_000)
    city.tiles = {t.id: t for t in tiles}
    city.occupied = {}
    for tile in city.tiles.values():
        for row, col in tile.cells:
            city.occupied[(row, col)] = tile.id
    city._targets_dirty = True
    city._recompute()
    return city


# ---- TransitManager 单元 ----
def test_line_requires_two_stops():
    manager = TransitManager()
    assert manager.create_line("一号线", "bus", ["a"]) is None
    line = manager.create_line("一号线", "bus", ["a", "b"])
    assert line is not None and len(line.stops) == 2


def test_line_ids_increment_and_delete_returns_bool():
    manager = TransitManager()
    first = manager.create_line("1", "bus", ["a", "b"])
    second = manager.create_line("2", "metro", ["c", "d"])
    assert first is not None and second is not None
    assert second.lid == first.lid + 1
    assert manager.delete_line(first.lid) is True
    assert manager.delete_line(first.lid) is False


def test_price_is_clamped_to_kind_cap():
    manager = TransitManager()
    line = manager.create_line("1", "bus", ["a", "b"])
    assert line is not None
    manager.set_price(line.lid, 999)
    assert manager.lines[line.lid].price == float(LINE_KINDS["bus"]["max_price"])
    manager.set_price(line.lid, -5)
    assert manager.lines[line.lid].price == 0.0


def test_ride_minutes_follows_stop_order():
    manager = TransitManager()
    line = manager.create_line("1", "metro", ["a", "b", "c"])
    assert line is not None
    assert manager.ride_minutes(line, "a", "c") == pytest.approx(2.4)
    assert manager.ride_minutes(line, "c", "a") == pytest.approx(2.4)
    assert manager.ride_minutes(line, "a", "a") is None


def test_snapshot_round_trip():
    manager = TransitManager()
    manager.create_line("1", "bus", ["a", "b"], color="#FF0000")
    manager.set_price(1, 1.5)
    restored = TransitManager.from_snapshot(manager.to_snapshot())
    assert [line.to_dict() for line in restored.lines.values()] == [
        line.to_dict() for line in manager.lines.values()
    ]
    assert restored._next_id == manager._next_id


# ---- 交通接入：有线路时通勤时间更短 ----
def _commute(with_transit: bool) -> tuple[float, float]:
    # 长距离走廊：36 格（1.8km）步行，公交才有优势
    tiles = [_tile("home", TileType.RES_LOW, 5, 5), _tile("job", TileType.COM_SHOP, 5, 41)]
    for c in range(6, 41):
        tiles.append(_tile(f"road{c}", TileType.TRANS_ROAD, 5, c))
    tiles.append(_tile("stop1", TileType.TRANS_METRO, 5, 6))
    tiles.append(_tile("stop2", TileType.TRANS_METRO, 5, 40))
    city = _city(tiles)
    stats = residential_stats(city.parcel, list(city.tiles.values()), CONFIG)
    manager = None
    if with_transit:
        manager = TransitManager()
        manager.create_line("快线", "metro", ["stop1", "stop2"])
    result = compute_traffic(city.parcel, list(city.tiles.values()), stats, CONFIG, manager)
    return float(result.avg_commute), result.congestion


def test_transit_reduces_commute():
    without, _ = _commute(False)
    with_transit, _ = _commute(True)
    assert with_transit < without


# ---- CityState 操作 ----
def test_city_create_line_checks_stop_type():
    city = _city(
        [
            _tile("stop1", TileType.TRANS_METRO, 5, 5),
            _tile("stop2", TileType.TRANS_METRO, 5, 9),
            _tile("notstop", TileType.RES_LOW, 6, 6),
        ]
    )
    lid, reason = city.create_transit_line("线", "bus", ["stop1", "notstop"])
    assert lid is None and reason == "NOT_ENOUGH_STOPS"
    lid, reason = city.create_transit_line("线", "bus", ["stop1", "stop2"])
    assert reason is None and lid is not None
    assert city.funds == 1_000_000 - int(LINE_KINDS["bus"]["cost"])


def test_city_add_and_remove_stop():
    city = _city(
        [
            _tile("s1", TileType.TRANS_METRO, 5, 5),
            _tile("s2", TileType.TRANS_METRO, 5, 7),
            _tile("s3", TileType.TRANS_METRO, 5, 9),
        ]
    )
    lid, _ = city.create_transit_line("线", "bus", ["s1", "s2"])
    assert lid is not None
    assert city.add_transit_stop(lid, "s3") is None
    assert len(city.transit.lines[lid].stops) == 3
    assert city.add_transit_stop(lid, "s1") == "REJECTED"
    assert city.remove_transit_stop(lid, "s2") is None
    assert city.transit.lines[lid].stops == ["s1", "s3"]


def test_transit_survives_snapshot():
    city = _city([_tile("s1", TileType.TRANS_METRO, 5, 5), _tile("s2", TileType.TRANS_METRO, 5, 7)])
    city.create_transit_line("线", "metro", ["s1", "s2"])
    restored = CityState.from_snapshot(city.to_snapshot())
    assert restored.transit.to_snapshot() == city.transit.to_snapshot()
