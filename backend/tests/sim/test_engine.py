"""引擎测试（PR-06 DoD）：手算样例 + 黄金样例 + p95 性能。

手算依据 03 §4：容量/吸引力/职住比/地价/税收公式逐条核对。
"""

import time

import pytest

from app.config import load_sim_config
from app.contracts.metrics import Phase
from app.contracts.parcel import Parcel, ParcelConstraints, Terrain
from app.contracts.tile import Tile, TileType
from app.core.session import GameSession
from app.sim import engine
from app.sim.catalog import CATALOG, expand_cells
from app.sim.economy import job_res_ratio, jobs_of, tax_income
from app.sim.generator import generate_parcel
from app.sim.green import green_cells, green_ratio
from app.sim.population import population_of, residential_stats

CONFIG = load_sim_config()
SIZE = 48


def flat_parcel(hills: list[tuple[int, int]] | None = None) -> Parcel:
    terrain = [[Terrain.FLAT for _ in range(SIZE)] for _ in range(SIZE)]
    for r, c in hills or []:
        terrain[r][c] = Terrain.HILL
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


def make_tile(tile_type: TileType, anchor: list[int]) -> Tile:
    cells = expand_cells(tile_type, anchor)
    return Tile(
        id=f"{tile_type.value}@{anchor}",
        type=tile_type,
        anchor=anchor,
        cells=cells,
        built_at_year=1,
        upkeep=CATALOG[tile_type].upkeep,
    )


def stats_of(parcel: Parcel, tiles: list[Tile]):
    return residential_stats(parcel, tiles, CONFIG)


class TestPopulation:
    def test_single_res_mid_capped_at_95pct(self):
        # 吸引力=1 → 入住 900；全城封顶 min(900, 900×0.95)=855
        stats = stats_of(flat_parcel(), [make_tile(TileType.RES_MID, [10, 10])])
        assert population_of(stats) == 855

    def test_park_bonus_capped_by_attraction_1(self):
        # 公园 +0.10，但 min(1, 吸引力) 仍 =1 → 855
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.GREEN_PARK, [10, 12])]
        assert population_of(stats_of(flat_parcel(), tiles)) == 855

    def test_heavy_industry_penalty(self):
        # 300m 内重工业 −0.15 → 900×0.85=765（低于 855 封顶线）
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.IND_HEAVY, [12, 10])]
        assert population_of(stats_of(flat_parcel(), tiles)) == 765

    def test_school_offsets_heavy_penalty(self):
        # 1 + 0.08(学校 d=14≤16) − 0.15(重工业) = 0.93 → 837
        tiles = [
            make_tile(TileType.RES_MID, [10, 10]),
            make_tile(TileType.EDU_SCHOOL, [10, 24]),
            make_tile(TileType.IND_HEAVY, [12, 10]),
        ]
        assert population_of(stats_of(flat_parcel(), tiles)) == 837

    def test_hill_penalty(self):
        # 1 − 0.15 − 0.05 = 0.80 → 720
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.IND_HEAVY, [12, 10])]
        parcel = flat_parcel(hills=[(10, 10)])
        assert population_of(stats_of(parcel, tiles)) == 720

    def test_two_residences_sum(self):
        tiles = [make_tile(TileType.RES_LOW, [5, 5]), make_tile(TileType.RES_MID, [20, 20])]
        assert population_of(stats_of(flat_parcel(), tiles)) == 285 + 855


class TestJobs:
    def test_jobs_sum(self):
        tiles = [
            make_tile(TileType.COM_SHOP, [1, 1]),
            make_tile(TileType.COM_CBD, [5, 5]),
            make_tile(TileType.IND_LIGHT, [10, 10]),
            make_tile(TileType.IND_HEAVY, [20, 20]),
        ]
        assert jobs_of(tiles, CONFIG) == 80 + 1200 + 900 + 2600

    def test_job_res_ratio_zero_population(self):
        assert job_res_ratio(100, 0) == 0.0


class TestLandPrice:
    def test_no_residence_is_100(self):
        tiles = [make_tile(TileType.COM_CBD, [5, 5])]
        stats = stats_of(flat_parcel(), tiles)
        from app.sim.landprice import land_price_index

        assert land_price_index(flat_parcel(), tiles, stats, CONFIG) == 100.0

    def test_cbd_bonus_weighted_average(self):
        # res_low(入住285, 地价100) + res_mid(入住855, 地价108，cbd d=4≤8)
        # (100×285 + 108×855)/1140 = 106.0
        tiles = [
            make_tile(TileType.RES_LOW, [5, 5]),
            make_tile(TileType.RES_MID, [20, 20]),
            make_tile(TileType.COM_CBD, [20, 24]),
        ]
        parcel = flat_parcel()
        stats = stats_of(parcel, tiles)
        from app.sim.landprice import land_price_index

        assert land_price_index(parcel, tiles, stats, CONFIG) == 106.0

    def test_metro_bonus(self):
        # 再加地铁 d=8≤12 → res_mid 地价 114 → (28500+97470)/1140 = 110.5
        tiles = [
            make_tile(TileType.RES_LOW, [5, 5]),
            make_tile(TileType.RES_MID, [20, 20]),
            make_tile(TileType.COM_CBD, [20, 24]),
            make_tile(TileType.TRANS_METRO, [20, 28]),
        ]
        parcel = flat_parcel()
        stats = stats_of(parcel, tiles)
        from app.sim.landprice import land_price_index

        assert land_price_index(parcel, tiles, stats, CONFIG) == 110.5

    def test_hill_penalty(self):
        parcel = flat_parcel(hills=[(10, 10)])
        tiles = [make_tile(TileType.RES_MID, [10, 10])]
        stats = stats_of(parcel, tiles)
        from app.sim.landprice import land_price_index

        assert land_price_index(parcel, tiles, stats, CONFIG) == 92.0


class TestEconomy:
    def test_tax_income_hand_computed(self):
        # 人口 1140、地价 106、岗位 1200 → 1140×1200×1.06 + 1200×500 = 2,050,080
        tiles = [
            make_tile(TileType.RES_LOW, [5, 5]),
            make_tile(TileType.RES_MID, [20, 20]),
            make_tile(TileType.COM_CBD, [20, 24]),
        ]
        stats = stats_of(flat_parcel(), tiles)
        assert tax_income(stats, 1200, 106.0) == 2_050_080

    def test_upkeep_sums_catalog(self):
        tiles = [make_tile(TileType.RES_LOW, [5, 5]), make_tile(TileType.COM_CBD, [20, 20])]
        assert sum(t.upkeep for t in tiles) == 8_000 + 150_000


class TestGreenRatio:
    def test_park_and_plaza_cells(self):
        tiles = [make_tile(TileType.GREEN_PARK, [0, 0]), make_tile(TileType.GREEN_PLAZA, [5, 5])]
        assert green_ratio(flat_parcel(), tiles) == round(5 / 2304, 4)

    def test_forest_cleared_by_building(self):
        parcel = flat_parcel()
        parcel.terrain[1][1] = Terrain.FOREST
        parcel.terrain[1][2] = Terrain.FOREST
        # 公园落在 forest 上不重复计；住宅铲掉另一格 forest
        tiles = [make_tile(TileType.GREEN_PARK, [1, 1]), make_tile(TileType.RES_LOW, [1, 2])]
        assert green_cells(parcel, tiles) == {(1, 1)}


class TestDiff:
    def test_diff_only_changed_fields(self):
        parcel = flat_parcel()
        before = engine.recompute(parcel, [], CONFIG, funds=5_000_000)
        after = engine.recompute(
            parcel, [make_tile(TileType.RES_MID, [10, 10])], CONFIG, funds=4_780_000
        )
        diff = engine.metrics_diff(before, after)
        assert diff.delta["funds"] == 4_780_000
        assert diff.delta["population"] == 855
        assert diff.delta["upkeep"] == 12_000
        assert "land_price_index" not in diff.delta  # 未变化不带
        assert "at_phase" not in diff.delta

    def test_diff_from_none_carries_all(self):
        after = engine.recompute(flat_parcel(), [], CONFIG, funds=5_000_000)
        diff = engine.metrics_diff(None, after)
        assert diff.delta["population"] == 0


class TestGoldenSample:
    """固定布局 → 固定人口/地价/资金（PR-06 DoD 黄金样例）。

    地块 seed=882314；三个锚点为行优先扫描的首个可用 flat 格（确定性）。
    """

    def _play(self) -> GameSession:
        session = GameSession(
            "golden", parcel=generate_parcel(882314, CONFIG), config=CONFIG
        )
        session.advance()

        def first_flat(pred=lambda r, c: True) -> list[int]:
            for r, row in enumerate(session.parcel.terrain):
                for c, t in enumerate(row):
                    if t is Terrain.FLAT and pred(r, c) and (r, c) not in session.occupied:
                        return [r, c]
            raise AssertionError("无可用 flat")

        session.place(TileType.RES_MID, first_flat())
        session.place(TileType.RES_HIGH, first_flat(lambda r, c: r >= 24))
        session.place(TileType.GREEN_PARK, first_flat(lambda r, c: r >= 24 and c >= 24))
        return session

    def test_golden_metrics(self):
        m = self._play().metrics
        assert m.funds == 4_030_000
        assert m.population == 3135  # 855 + 2280
        assert m.jobs == 0
        assert m.land_price_index == 100.0
        assert m.green_ratio == 0.0551
        assert m.tax_income == 3_762_000  # 3135×1200×1.0
        assert m.upkeep == 47_000  # 12000+30000+5000

    def test_golden_reproducible(self):
        assert self._play().metrics == self._play().metrics


class TestPerformance:
    def test_recompute_p95_under_10ms(self):
        """PR-06 DoD：重算 p95 <10ms 记录在案（60 区块城市 ×200 次重算）。

        直接构造区块绕开放置的资金约束（性能测的是引擎不是校验）。
        """
        parcel = generate_parcel(882314, CONFIG)
        types = [
            TileType.RES_MID,
            TileType.RES_HIGH,
            TileType.COM_SHOP,
            TileType.GREEN_PARK,
            TileType.EDU_SCHOOL,
            TileType.MED_CLINIC,
            TileType.TRANS_METRO,
        ]
        buildable = {Terrain.FLAT, Terrain.HILL, Terrain.FOREST}
        occupied: set[tuple[int, int]] = set()
        tiles: list[Tile] = []
        for r in range(0, SIZE - 2, 2):
            for c in range(0, SIZE - 2, 2):
                if len(tiles) >= 60:
                    break
                tile = make_tile(types[len(tiles) % len(types)], [r, c])
                cells = {(rr, cc) for rr, cc in tile.cells}
                if cells & occupied:
                    continue
                if any(parcel.terrain[rr][cc] not in buildable for rr, cc in cells):
                    continue
                tiles.append(tile)
                occupied |= cells
        assert len(tiles) >= 40
        timings = []
        for _ in range(200):
            start = time.perf_counter()
            engine.recompute(parcel, tiles, CONFIG, funds=5_000_000)
            timings.append((time.perf_counter() - start) * 1000)
        timings.sort()
        p95 = timings[int(len(timings) * 0.95)]
        print(f"\n[perf] tiles={len(tiles)} p50={timings[100]:.3f}ms p95={p95:.3f}ms")
        assert p95 < 10.0


class TestPhaseInMetrics:
    def test_at_phase_follows_session(self):
        session = GameSession("p", parcel=generate_parcel(1, CONFIG), config=CONFIG)
        assert session.metrics.at_phase is Phase.BRIEFING
        session.advance()
        assert session.metrics.at_phase is Phase.BUILD


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_engine_never_negative_population(seed):
    parcel = generate_parcel(seed, CONFIG)
    m = engine.recompute(parcel, [], CONFIG, funds=CONFIG.economy.initial_funds)
    assert m.population == 0
    assert m.land_price_index == 100.0
    assert m.green_ratio > 0  # 林地计入绿地率
