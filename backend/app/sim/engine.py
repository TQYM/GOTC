"""引擎门面（06 §2 / 03 §1）：每次操作后全量重算，输出 Metrics 与逐字段 diff。

PR-06 覆盖 03 §4.1–4.6、4.11、4.12；PR-07 接入交通（§4.7–4.8）；
pollution/happiness/coverage（PR-08）暂为占位值。
"""

from app.config import SimConfig
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import Parcel
from app.contracts.tile import Tile
from app.sim.economy import job_res_ratio, jobs_of, tax_income, upkeep_of
from app.sim.green import green_ratio
from app.sim.landprice import land_price_index
from app.sim.population import population_of, residential_stats
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
) -> Metrics:
    """全量重算（03 §1：48×48 全量 <10ms，不做增量）。"""
    stats = residential_stats(parcel, tiles, config)
    population = population_of(stats)
    jobs = jobs_of(tiles, config)
    land_price = land_price_index(parcel, tiles, stats, config)
    traffic = compute_traffic(parcel, tiles, stats, config)
    return Metrics(
        at_year=at_year,
        at_phase=at_phase,
        funds=funds,
        population=population,
        jobs=jobs,
        job_res_ratio=job_res_ratio(jobs, population),
        land_price_index=land_price,
        green_ratio=green_ratio(parcel, tiles),
        avg_commute=traffic.avg_commute,
        congestion=traffic.congestion,
        pollution=0.0,  # PR-08
        happiness=50,  # PR-08
        tax_income=tax_income(stats, jobs, land_price),
        upkeep=upkeep_of(tiles),
        coverage_edu=0.0,  # PR-08
        coverage_med=0.0,  # PR-08
    )


def metrics_diff(before: Metrics | None, after: Metrics) -> MetricsDiff:
    """逐字段 diff（02 §2.2）：只带变化字段的新值。"""
    if before is None:
        delta = {
            k: v for k, v in after.model_dump().items() if k not in _META_FIELDS
        }
    else:
        old = before.model_dump()
        new = after.model_dump()
        delta = {
            k: new[k]
            for k in new
            if k not in _META_FIELDS and new[k] != old[k]
        }
    return MetricsDiff(at_year=after.at_year, delta=delta)
