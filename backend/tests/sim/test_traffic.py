"""交通测试（PR-07 DoD）：BPR 手算样例、无桥惩罚、桥/地铁、桥放置展开。

手算依据 03 §4.7–4.8：t = Σ格 t0×(1+0.15×(V/C)^4)，t0=0.5，C=800/1500。
"""

from app.config import load_sim_config
from app.contracts.parcel import Parcel, ParcelConstraints, Terrain
from app.contracts.tile import Tile, TileType
from app.core.errors import GameError
from app.core.session import GameSession
from app.sim import engine
from app.sim.catalog import CATALOG, bridge_cells, expand_cells
from app.sim.generator import generate_parcel
from app.sim.population import residential_stats
from app.sim.traffic import compute_traffic

CONFIG = load_sim_config()
SIZE = 48


def make_parcel(river_col: int | None = None) -> Parcel:
    terrain = [[Terrain.FLAT for _ in range(SIZE)] for _ in range(SIZE)]
    if river_col is not None:
        for r in range(SIZE):
            terrain[r][river_col] = Terrain.RIVER
    return Parcel(
        seed=0,
        size=SIZE,
        terrain=terrain,
        inherited_road=[],
        constraints=ParcelConstraints(
            height_limit_m=80,
            green_line_m=30,
            buildable_ratio=1.0,
            briefing={"text": "t", "source": "template"},
        ),
    )


def make_tile(tile_type: TileType, anchor: list[int], cells: list[list[int]] | None = None) -> Tile:
    return Tile(
        id=f"{tile_type.value}@{anchor}",
        type=tile_type,
        anchor=anchor,
        cells=cells if cells is not None else expand_cells(tile_type, anchor),
        orientation="horizontal" if tile_type is TileType.UTIL_BRIDGE else None,
        built_at_year=1,
        upkeep=CATALOG[tile_type].upkeep,
    )


def find_bridge_anchor(parcel: Parcel, orientation: str = "horizontal"):
    for r, row in enumerate(parcel.terrain):
        for c, terrain in enumerate(row):
            if terrain is not Terrain.BANK:
                continue
            try:
                return [r, c], bridge_cells(parcel, [r, c], orientation)
            except ValueError:
                pass
    raise AssertionError("测试地块没有合法桥位")


def traffic_of(parcel: Parcel, tiles: list[Tile]):
    stats = residential_stats(parcel, tiles, CONFIG)
    return compute_traffic(parcel, tiles, stats, CONFIG)


class TestBPR:
    def test_hand_computed_commute_and_congestion(self):
        """res_mid(855人) → shop(10格)：t = 10×0.5×(1+0.15×(855/800)^4) ≈ 5.98 → 6。"""
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.COM_SHOP, [10, 20])]
        result = traffic_of(make_parcel(), tiles)
        expected = 10 * 0.5 * (1 + 0.15 * (855 / 800) ** 4)
        assert round(expected) == 6  # 手算 ≈5.98
        assert result.avg_commute == 6
        assert result.congestion == round(855 / 800, 4)  # 1.0688
        assert result.congestion > 0.9  # DoD：拥堵 >0.9 样例

    def test_no_jobs_no_commute(self):
        result = traffic_of(make_parcel(), [make_tile(TileType.RES_MID, [10, 10])])
        assert result.avg_commute == 0
        assert result.congestion == 0.0

    def test_metro_fixed_commute(self):
        """地铁 600m（12 格）内：固定 8 分钟，不累计负载。"""
        tiles = [
            make_tile(TileType.RES_MID, [10, 10]),
            make_tile(TileType.COM_SHOP, [10, 20]),
            make_tile(TileType.TRANS_METRO, [10, 14]),
        ]
        result = traffic_of(make_parcel(), tiles)
        assert result.avg_commute == 8
        assert result.congestion == 0.0


class TestRiverCrossing:
    def test_no_bridge_unreachable_penalty(self):
        """无桥过河：不可达比例 100% >5% → 自由流 20×0.5=10 + 20 惩罚 = 30。"""
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.COM_SHOP, [10, 30])]
        result = traffic_of(make_parcel(river_col=24), tiles)
        assert result.unreachable_share == 1.0
        assert result.avg_commute == 30
        assert result.congestion == 0.0

    def test_bridge_restores_commute(self):
        """架桥后：20 格路径全负载 855 → t = 20×0.5×1.1957 ≈ 11.96 → 12，无惩罚。"""
        tiles = [
            make_tile(TileType.RES_MID, [10, 10]),
            make_tile(TileType.COM_SHOP, [10, 30]),
            make_tile(TileType.UTIL_BRIDGE, [10, 24], cells=[[10, 24]]),
        ]
        result = traffic_of(make_parcel(river_col=24), tiles)
        assert result.unreachable_share == 0.0
        expected = 20 * 0.5 * (1 + 0.15 * (855 / 800) ** 4)
        assert round(expected) == 12
        assert result.avg_commute == 12

    def test_bridge_cells_expansion(self):
        parcel = make_parcel(river_col=24)
        parcel.terrain[10][23] = Terrain.BANK
        parcel.terrain[10][25] = Terrain.BANK
        assert bridge_cells(parcel, [10, 23], "horizontal") == [
            [10, 23], [10, 24], [10, 25]
        ]
        vertical = make_parcel()
        vertical.terrain[9][10] = Terrain.BANK
        vertical.terrain[10][10] = Terrain.RIVER
        vertical.terrain[11][10] = Terrain.BANK
        assert bridge_cells(vertical, [9, 10], "vertical") == [[9, 10], [10, 10], [11, 10]]
        # river/flat 锚点均不合法；只有西侧或北侧 bank 可作为起点。
        for invalid in ([10, 24], [10, 10]):
            try:
                bridge_cells(parcel, invalid, "horizontal")
                raise AssertionError("应当拒绝")
            except ValueError:
                pass


class TestBridgePlacement:
    def test_place_bridge_on_generated_river(self):
        parcel = generate_parcel(882314, CONFIG)
        session = GameSession("b", parcel=parcel, config=CONFIG)
        session.advance()
        anchor, expected = find_bridge_anchor(parcel)
        tile, metrics, _, funds = session.place(
            TileType.UTIL_BRIDGE, anchor, orientation="horizontal"
        )
        assert tile.cells == expected
        n = len(expected)
        assert funds == 5_000_000 - 200_000 * n
        assert tile.upkeep == 10_000 * n
        assert metrics.upkeep == 10_000 * n

    def test_place_bridge_on_flat_rejected(self):
        parcel = generate_parcel(882314, CONFIG)
        session = GameSession("b2", parcel=parcel, config=CONFIG)
        session.advance()
        flat = next(
            (r, c)
            for r, row in enumerate(parcel.terrain)
            for c, t in enumerate(row)
            if t is Terrain.FLAT
        )
        try:
            session.place(TileType.UTIL_BRIDGE, list(flat), orientation="horizontal")
            raise AssertionError("应当拒绝")
        except GameError as exc:
            assert exc.code.value == "invalid_placement"


class TestEngineIntegration:
    def test_metrics_include_traffic(self):
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.COM_SHOP, [10, 20])]
        m = engine.recompute(make_parcel(), tiles, CONFIG, funds=5_000_000)
        assert m.avg_commute == 6
        assert m.congestion == round(855 / 800, 4)
