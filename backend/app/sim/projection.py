"""终局推演（03 §6）与结局判定（01 §7）：10 年快进，纯 sim 无 AI。

五维评分公式 02 契约只定形状未定算法，本模块定义为：
- population：入住 ÷ (Σ住宅容量×0.95) ×100（无住宅=0）
- balance：max(0, 100 − |职住比−1|×100)
- green：min(1, 绿地率÷0.30)×100（对标 GB50180 新建城区 0.30）
- traffic：100×(1−min(通勤,120)÷120)×0.5 + 100×(1−min(拥堵,2)÷2)×0.5
- happiness：幸福度原值
"""

from dataclasses import dataclass

from app.config import SimConfig
from app.contracts.finalize import Ending, ProjectionYear, Scores
from app.contracts.metrics import Metrics, Phase
from app.contracts.parcel import Parcel
from app.contracts.tile import Tile, TileType
from app.sim import engine
from app.sim.events import modifier_for, roll_event
from app.sim.population import ResStat, residential_stats

MIGRATION_LIMIT = 0.08  # 每年人口迁移上限 ±8%（03 §6）
EXODUS_THRESHOLD = 40  # 幸福度连续两年 <40 → 额外 −5%
EXODUS_PENALTY = 0.05


@dataclass(frozen=True)
class ProjectionOutcome:
    projection: list[ProjectionYear]
    ending: Ending
    scores: Scores


def determine_ending(
    metrics: Metrics, *, bankrupt: bool, res_capacity: int, industry_count: int
) -> Ending:
    """01 §7：优先级从高到低，首个命中即定。"""
    if bankrupt:
        return Ending.BANKRUPT
    if metrics.green_ratio >= 0.55 and industry_count == 0:
        return Ending.ECO_PARADISE
    if metrics.avg_commute > 75 and metrics.congestion > 0.9:
        return Ending.GRIDLOCK
    if res_capacity > 0 and metrics.population < res_capacity * 0.2:
        return Ending.GHOST_TOWN
    if (
        metrics.happiness >= 70
        and 0.85 <= metrics.job_res_ratio <= 1.15
        and metrics.congestion < 0.6
    ):
        return Ending.THRIVING
    return Ending.ORDINARY


def scores_of(metrics: Metrics, res_capacity: int) -> Scores:
    cap = res_capacity * 0.95
    commute_part = 100 * (1 - min(metrics.avg_commute, 120) / 120)
    congestion_part = 100 * (1 - min(metrics.congestion, 2.0) / 2.0)
    return Scores(
        population=round(min(1.0, metrics.population / cap) * 100) if cap > 0 else 0,
        balance=max(0, round(100 - abs(metrics.job_res_ratio - 1) * 100)),
        green=round(min(1.0, metrics.green_ratio / 0.30) * 100),
        traffic=round((commute_part + congestion_part) / 2),
        happiness=metrics.happiness,
    )


def _year_events(prev: Metrics | None, cur: Metrics) -> list[str]:
    """03 §6 步骤 5：阈值规则模板，每年 0–2 条标签。"""
    labels: list[str] = []
    if prev is not None and prev.land_price_index > 0:
        if cur.land_price_index > prev.land_price_index * 1.10:
            labels.append("地价上涨超10%")
    if cur.congestion > 0.9:
        labels.append("拥堵突破0.9")
    if prev is not None and prev.happiness < 60 <= cur.happiness:
        labels.append("幸福度突破60")
    if prev is not None and cur.population < prev.population * 0.97:
        labels.append("人口外流")
    return labels[:2]


def run_projection(
    parcel: Parcel,
    tiles: list[Tile],
    config: SimConfig,
    *,
    funds: int,
    start_year: int,
    cleared_forest: bool,
) -> ProjectionOutcome:
    """从当前布局快进 10 年：迁移限速 → 全量重算 → 结算 → 事件标签 → 快照。"""
    base_stats = residential_stats(parcel, tiles, config)
    current_occ = {s.tile_id: s.occupancy for s in base_stats}
    res_capacity = sum(s.capacity for s in base_stats)
    industry_count = sum(1 for t in tiles if t.type in (TileType.IND_LIGHT, TileType.IND_HEAVY))

    projection: list[ProjectionYear] = []
    prev_metrics: Metrics | None = None
    bankrupt = False
    low_happiness_streak = 0
    for year in range(start_year + 1, start_year + config.economy.projection_years + 1):
        # 1. 迁移：向目标入住靠拢，每年最多 ±8%
        stats: list[ResStat] = []
        for s in base_stats:
            cur = current_occ[s.tile_id]
            target = s.occupancy
            lo, hi = cur * (1 - MIGRATION_LIMIT), cur * (1 + MIGRATION_LIMIT)
            occ = max(lo, min(hi, target))
            if low_happiness_streak >= 2:
                occ *= 1 - EXODUS_PENALTY  # 3. 逃离潮
            current_occ[s.tile_id] = occ
            stats.append(ResStat(s.tile_id, s.anchor, s.capacity, s.attraction, occ))

        # 2. 全量重算（含当年环境事件修正）
        event_id = roll_event(parcel.seed, year, cleared_forest)
        metrics = engine.recompute(
            parcel,
            tiles,
            config,
            funds=funds,
            at_year=year,
            at_phase=Phase.LOCKED,
            stats_override=stats,
            modifier=modifier_for(event_id),
        )

        # 4. 资金结算与破产判定（01 §7）
        funds = funds + metrics.tax_income - metrics.upkeep
        if funds < 0 and metrics.tax_income < metrics.upkeep * 0.8:
            bankrupt = True
        metrics = metrics.model_copy(update={"funds": funds})

        # 5–6. 事件标签与快照
        labels = _year_events(prev_metrics, metrics)
        if event_id:
            from app.sim.events import EVENT_LABELS

            labels = (labels + [EVENT_LABELS[event_id]])[:2]
        projection.append(ProjectionYear(year=year, metrics=metrics, events=labels))
        prev_metrics = metrics
        low_happiness_streak = (
            low_happiness_streak + 1 if metrics.happiness < EXODUS_THRESHOLD else 0
        )

    final = projection[-1].metrics
    ending = determine_ending(
        final, bankrupt=bankrupt, res_capacity=res_capacity, industry_count=industry_count
    )
    return ProjectionOutcome(projection, ending, scores_of(final, res_capacity))
