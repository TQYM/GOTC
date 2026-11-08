"""引擎门面（06 §2 / 03 §1）：每次操作后全量重算，14 项指标全真。

stats_override 供终局推演传入迁移限速后的住宅统计（03 §6）；
modifier 为环境事件的一年期数值修正（03 §7）。
"""

from app.config import SimConfig
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import Parcel
from app.contracts.tile import Tile, TileType
from app.sim.coverage import coverage
from app.sim.economy import job_res_ratio, jobs_of, tax_income, upkeep_of
from app.sim.events import EventModifier
from app.sim.green import green_ratio
from app.sim.happiness import compute_happiness
from app.sim.landprice import land_price_index
from app.sim.pollution import city_pollution
from app.sim.population import ResStat, population_of, residential_stats
from app.sim.traffic import compute_traffic

# diff 不追踪的元信息字段（at_year/at_phase 由事件自身携带）
_META_FIELDS = {"at_year", "at_phase"}


def recompute(
    parcel: Parcel,
    tiles: list[Tile],
    config: SimConfig,
    *,
    funds: int,
    at_year: int = 1,
    at_phase: Phase = Phase.BUILD,
    stats_override: list[ResStat] | None = None,
    modifier: EventModifier | None = None,
    existing_population: int = 0,
    existing_jobs: int = 0,
    existing_upkeep: int = 0,
    happiness_adjustment: int = 0,
) -> Metrics:
    """全量重算（03 §1：48×48 全量 <10ms，不做增量）。"""
    mod = modifier or EventModifier()
    stats = (
        stats_override
        if stats_override is not None
        else residential_stats(parcel, tiles, config)
    )
    population = population_of(stats) + existing_population
    jobs = jobs_of(tiles, config) + existing_jobs
    land_price = round(land_price_index(parcel, tiles, stats, config) + mod.land_bonus, 1)
    traffic = compute_traffic(parcel, tiles, stats, config)
    green = green_ratio(parcel, tiles)
    pollution = city_pollution(parcel, tiles, stats, config)
    edu, med = coverage(stats, tiles, config)
    res_high = sum(1 for t in tiles if t.type is TileType.RES_HIGH)
    res_total = sum(
        1 for t in tiles if t.type in (TileType.RES_LOW, TileType.RES_MID, TileType.RES_HIGH)
    )
    happiness = compute_happiness(
        green_ratio=green,
        avg_commute=traffic.avg_commute,
        job_res_ratio=job_res_ratio(jobs, population),
        pollution=pollution,
        land_price_index=land_price,
        coverage_edu=edu,
        coverage_med=med,
        res_high_share=res_high / res_total if res_total else 0.0,
        event_delta=mod.happiness_delta + happiness_adjustment,
    )
    return Metrics(
        at_year=at_year,
        at_phase=at_phase,
        funds=funds,
        population=population,
        jobs=jobs,
        job_res_ratio=job_res_ratio(jobs, population),
        land_price_index=land_price,
        green_ratio=green,
        avg_commute=traffic.avg_commute,
        congestion=traffic.congestion,
        pollution=pollution,
        happiness=happiness,
        tax_income=tax_income(
            stats,
            jobs,
            land_price,
            job_mult=mod.job_tax_mult,
            additional_population=existing_population,
        ),
        upkeep=round((upkeep_of(tiles) + existing_upkeep) * mod.upkeep_mult),
        coverage_edu=edu,
        coverage_med=med,
    )


def metrics_diff(before: Metrics | None, after: Metrics) -> MetricsDiff:
    """逐字段 diff（02 §2.2）：只带变化字段的新值。"""
    if before is None:
        delta = {k: v for k, v in after.model_dump().items() if k not in _META_FIELDS}
    else:
        old = before.model_dump()
        new = after.model_dump()
        delta = {k: new[k] for k in new if k not in _META_FIELDS and new[k] != old[k]}
    return MetricsDiff(at_year=after.at_year, delta=delta)
