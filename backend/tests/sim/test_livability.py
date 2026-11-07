"""PR-08 测试：污染/幸福度/覆盖率、环境事件、年度结算、10 年推演与结局。"""

import pytest

from app.config import load_sim_config
from app.contracts.finalize import Ending
from app.contracts.metrics import Phase
from app.contracts.parcel import Parcel, ParcelConstraints, Terrain
from app.contracts.tile import Tile, TileType
from app.core.session import GameSession
from app.sim import engine
from app.sim.catalog import CATALOG, expand_cells
from app.sim.coverage import coverage
from app.sim.events import FOREST_PROTEST, modifier_for, roll_event
from app.sim.generator import generate_parcel
from app.sim.happiness import compute_happiness
from app.sim.pollution import city_pollution
from app.sim.population import residential_stats
from app.sim.projection import determine_ending, run_projection, scores_of

CONFIG = load_sim_config()
SIZE = 48


def make_parcel(forest: bool = False) -> Parcel:
    return Parcel(
        seed=0,
        size=SIZE,
        terrain=[
            [Terrain.FOREST if forest else Terrain.FLAT for _ in range(SIZE)] for _ in range(SIZE)
        ],
        inherited_road=[],
        constraints=ParcelConstraints(
            height_limit_m=80,
            green_line_m=30,
            buildable_ratio=1.0,
            briefing={"text": "t", "source": "template"},
        ),
    )


def make_tile(tile_type: TileType, anchor: list[int]) -> Tile:
    return Tile(
        id=f"{tile_type.value}@{anchor}",
        type=tile_type,
        anchor=anchor,
        cells=expand_cells(tile_type, anchor),
        orientation="horizontal" if tile_type is TileType.UTIL_BRIDGE else None,
        built_at_year=1,
        upkeep=CATALOG[tile_type].upkeep,
    )


def stats_of(parcel, tiles):
    return residential_stats(parcel, tiles, CONFIG)


class TestPollution:
    def test_hand_computed_exposure(self):
        """重工业 [10,10]，住宅 [10,12]（d=2）：暴露 = 0.35−0.05×2 = 0.25。"""
        tiles = [make_tile(TileType.IND_HEAVY, [10, 10]), make_tile(TileType.RES_MID, [10, 12])]
        stats = stats_of(make_parcel(), tiles)
        assert stats[0].occupancy == 765  # 300m 内重工业 → 吸引力 0.85
        assert city_pollution(make_parcel(), tiles, stats, CONFIG) == 0.25

    def test_no_residence_quarter_mean(self):
        """无住宅：单重工业 Σ=11.55 → 11.55/2304×0.25 ≈ 0.0013。"""
        tiles = [make_tile(TileType.IND_HEAVY, [24, 24])]
        value = city_pollution(make_parcel(), tiles, [], CONFIG)
        assert value == round(11.55 / (SIZE * SIZE) * 0.25, 4)

    def test_light_industry_smaller(self):
        tiles = [make_tile(TileType.IND_LIGHT, [10, 10]), make_tile(TileType.RES_MID, [10, 12])]
        stats = stats_of(make_parcel(), tiles)
        assert city_pollution(make_parcel(), tiles, stats, CONFIG) == pytest.approx(0.05)


class TestHappiness:
    def test_green_and_commute_case(self):
        """绿地 0.3（+9）+ 通勤 25（+10）+ 职住 1.0（+8）→ 77。"""
        value = compute_happiness(
            green_ratio=0.3,
            avg_commute=25,
            job_res_ratio=1.0,
            pollution=0.0,
            land_price_index=100.0,
            coverage_edu=0.0,
            coverage_med=0.0,
            res_high_share=0.0,
        )
        assert value == 50 + 9 + 10 + 8

    def test_pollution_case(self):
        """污染 0.25（−10）+ 通勤 0（+15）+ 职住失衡（−8）+ 地价 90（−2）→ 45。"""
        value = compute_happiness(
            green_ratio=0.0,
            avg_commute=0,
            job_res_ratio=3.4,
            pollution=0.25,
            land_price_index=90.0,
            coverage_edu=0.0,
            coverage_med=0.0,
            res_high_share=0.0,
        )
        assert value == 45

    def test_crowding_and_clamp(self):
        base = dict(
            green_ratio=0.0,
            avg_commute=30,
            job_res_ratio=1.0,
            pollution=0.0,
            land_price_index=100.0,
            coverage_edu=1.0,
            coverage_med=1.0,
            res_high_share=0.5,
        )
        assert compute_happiness(**base) == 50 + 10 + 8 + 12 - 6
        assert compute_happiness(**{**base, "green_ratio": 1.0}) == 100  # 104 截断到 100


class TestCoverage:
    def test_edu_med(self):
        tiles = [
            make_tile(TileType.RES_MID, [10, 10]),
            make_tile(TileType.EDU_SCHOOL, [10, 20]),  # d=10 ≤12 → 覆盖
            make_tile(TileType.MED_CLINIC, [10, 30]),  # d=20 >12 → 不覆盖
        ]
        edu, med = coverage(stats_of(make_parcel(), tiles), tiles, CONFIG)
        assert edu == 1.0
        assert med == 0.0


class TestEnvironmentEvents:
    def test_deterministic_roll(self):
        assert roll_event(882314, 3, False) == roll_event(882314, 3, False)
        # 扫 200 年：未铲森林时 protest 永不出现；概率约 5%
        hits = [roll_event(882314, y, False) for y in range(200)]
        assert FOREST_PROTEST not in hits
        fired = [h for h in hits if h]
        assert 2 <= len(fired) <= 30  # 200×5%=10，宽松区间防 flake

    def test_protest_only_after_clearing(self):
        hits = [roll_event(882314, y, True) for y in range(200)]
        assert any(h == FOREST_PROTEST for h in hits)

    def test_modifiers(self):
        assert modifier_for("flood").upkeep_mult == 1.15
        assert modifier_for("industry_boom").job_tax_mult == 1.20
        assert modifier_for("viral_spot").land_bonus == 5.0
        assert modifier_for(FOREST_PROTEST).happiness_delta == -5.0
        assert modifier_for(None).upkeep_mult == 1.0


class TestAnnualSettlement:
    def test_settle_updates_funds_and_year(self):
        parcel = generate_parcel(882314, CONFIG)
        session = GameSession("s", parcel=parcel, config=CONFIG)
        session.advance()
        # 造一座公园：upkeep 5000、tax 0（无住宅无岗位）
        flat = next(
            (r, c)
            for r, row in enumerate(parcel.terrain)
            for c, t in enumerate(row)
            if t is Terrain.FLAT
            and r + 2 < SIZE
            and c + 2 < SIZE
            and all(
                parcel.terrain[r + dr][c + dc] is Terrain.FLAT
                for dr in range(2)
                for dc in range(2)
            )
        )
        session.place(TileType.GREEN_PARK, list(flat))
        funds_before = session.funds
        tax, upkeep = session.metrics.tax_income, session.metrics.upkeep
        metrics, _ = session.settle_year()
        assert session.at_year == 2
        assert metrics.funds == funds_before + tax - upkeep
        assert session.years_settled == 1
        assert session.event_log[-1]["event"] == "tick"

    def test_timer_drives_phases(self):
        parcel = generate_parcel(882314, CONFIG)
        session = GameSession("t", parcel=parcel, config=CONFIG)
        start = session.phase_started_at
        session.timer_tick(start + 21)  # 过 briefing
        assert session.phase is Phase.BUILD
        build_start = session.phase_started_at
        session.timer_tick(build_start + 300)
        assert session.at_year == 2
        session.timer_tick(build_start + 600)
        assert session.at_year == 3
        session.timer_tick(build_start + 900)
        assert session.at_year == 4
        assert session.phase is Phase.POLISH
        session.timer_tick(session.phase_started_at + 121)
        assert session.finalized
        assert session.finalize_result is not None


class TestProjection:
    def test_ten_years_and_locked(self):
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.COM_SHOP, [10, 20])]
        outcome = run_projection(
            make_parcel(), tiles, CONFIG, funds=4_000_000, start_year=4, cleared_forest=False
        )
        assert [p.year for p in outcome.projection] == list(range(5, 15))
        assert all(p.metrics.at_phase is Phase.LOCKED for p in outcome.projection)
        assert all(len(p.events) <= 2 for p in outcome.projection)
        assert outcome.ending in set(Ending)

    def test_bankrupt(self):
        """只有公园（无税收），起始资金 1000 → 第一年资金转负且 tax < upkeep×0.8。"""
        tiles = [make_tile(TileType.GREEN_PARK, [10, 10])]
        outcome = run_projection(
            make_parcel(), tiles, CONFIG, funds=1000, start_year=4, cleared_forest=False
        )
        assert outcome.ending is Ending.BANKRUPT

    def test_eco_paradise(self):
        outcome = run_projection(
            make_parcel(forest=True),
            [],
            CONFIG,
            funds=5_000_000,
            start_year=4,
            cleared_forest=False,
        )
        assert outcome.ending is Ending.ECO_PARADISE

    def test_thriving(self):
        """res_mid + 轻工业（职住 900/855≈1.05）+ 地铁（通勤 8、拥堵 0）+ 学校/医院 → 幸福度 91。"""
        tiles = [
            make_tile(TileType.RES_MID, [10, 10]),
            make_tile(TileType.IND_LIGHT, [10, 30]),
            make_tile(TileType.TRANS_METRO, [10, 12]),
            make_tile(TileType.EDU_SCHOOL, [10, 16]),
            make_tile(TileType.MED_CLINIC, [10, 18]),
        ]
        outcome = run_projection(
            make_parcel(), tiles, CONFIG, funds=5_000_000, start_year=4, cleared_forest=False
        )
        final = outcome.projection[-1].metrics
        assert final.happiness >= 70
        assert 0.85 <= final.job_res_ratio <= 1.15
        assert final.congestion < 0.6
        assert outcome.ending is Ending.THRIVING

    def test_ghost_town_rule(self):
        """规则函数直测（当前吸引力公式下限 0.8，正常对局 ghost 不可达——PR 披露）。"""
        m = engine.recompute(
            make_parcel(), [make_tile(TileType.RES_MID, [10, 10])], CONFIG, funds=5_000_000
        )
        low = m.model_copy(update={"population": 100})
        assert determine_ending(low, bankrupt=False, res_capacity=900, industry_count=0) is (
            Ending.GHOST_TOWN
        )

    def test_scores_shape(self):
        m = engine.recompute(
            make_parcel(), [make_tile(TileType.RES_MID, [10, 10])], CONFIG, funds=5_000_000
        )
        scores = scores_of(m, 900)
        assert scores.population == 100  # 855/(900×0.95)=1.0 封顶
        assert 0 <= scores.green <= 100
        assert scores.happiness == m.happiness


class TestEngineIntegration:
    def test_full_metrics_live(self):
        tiles = [make_tile(TileType.IND_HEAVY, [10, 10]), make_tile(TileType.RES_MID, [10, 12])]
        m = engine.recompute(make_parcel(), tiles, CONFIG, funds=5_000_000)
        assert m.pollution == 0.25
        assert m.happiness == 45
        assert m.coverage_edu == 0.0

    def test_event_modifier_applied(self):
        tiles = [make_tile(TileType.RES_MID, [10, 10])]
        base = engine.recompute(make_parcel(), tiles, CONFIG, funds=5_000_000)
        viral = engine.recompute(
            make_parcel(), tiles, CONFIG, funds=5_000_000, modifier=modifier_for("viral_spot")
        )
        assert viral.land_price_index == base.land_price_index + 5
        flood = engine.recompute(
            make_parcel(),
            [make_tile(TileType.GREEN_PARK, [10, 10])],
            CONFIG,
            funds=5_000_000,
            modifier=modifier_for("flood"),
        )
        assert flood.upkeep == round(5000 * 1.15)


@pytest.mark.parametrize("seed", [882314, 7])
def test_projection_deterministic(seed):
    parcel = generate_parcel(seed, CONFIG)
    parcel = parcel.model_copy(update={"seed": seed})
    tiles = [make_tile(TileType.RES_MID, [0, 0])]
    a = run_projection(parcel, tiles, CONFIG, funds=5_000_000, start_year=4, cleared_forest=False)
    b = run_projection(parcel, tiles, CONFIG, funds=5_000_000, start_year=4, cleared_forest=False)
    assert a.projection == b.projection
    assert a.ending == b.ending
