"""财政（03 §4.11/4.12）与岗位（03 §4.3/4.4）。"""

from app.config import SimConfig
from app.contracts.tile import Tile, TileType
from app.sim.population import ResStat

# 税率常量（03 §4.11；未列入 §8 配置表，调参需同步文档）
DEFAULT_TAX_RATE = 9.0  # C:S 默认税率（%）
TAX_PER_PERSON = 1200  # 元/人·年（税率 9% 时）
TAX_PER_JOB = 500  # 元/岗·年


def jobs_of(
    tiles: list[Tile], config: SimConfig, built: dict[str, float] | None = None
) -> int:
    """jobs = Σ岗位 × 建成度（C:S 结构：划区不等于建成）。

    built 缺省视为 1.0（已建成），保证旧存档与既有测试不受影响。
    """
    emp = config.employment
    table = {
        TileType.COM_SHOP: emp.jobs_shop,
        TileType.COM_CBD: emp.jobs_cbd,
        TileType.IND_LIGHT: emp.jobs_light,
        TileType.IND_HEAVY: emp.jobs_heavy,
    }
    ratios = built or {}
    return round(
        sum(table.get(t.type, 0) * ratios.get(t.id, 1.0) for t in tiles)
    )


def job_res_ratio(jobs: int, population: int) -> float:
    """职住比 = jobs ÷ population（03 §4.4）；无人口时定义为 0（避免除零）。"""
    if population <= 0:
        return 0.0
    return round(jobs / population, 4)


def tax_income(
    stats: list[ResStat],
    jobs: int,
    city_land_price: float,
    job_mult: float = 1.0,
    additional_population: int = 0,
    tax_rate: float = DEFAULT_TAX_RATE,
) -> int:
    """年税收 = [Σ住宅入住×1200×(地价指数/100) + Σ岗位×500] × 税率/9（03 §4.11）。

    税率以 9% 为基准（C:S 的默认档），玩家把税率调到 1% 就只剩九分之一，
    调到 29% 则是三倍多——这是 C:S「税收是玩家直接旋钮」的最小复刻。

    job_mult：环境事件「产业风口」岗位税 +20%（03 §7）。
    """
    population = sum(s.occupancy for s in stats) + additional_population
    base = population * TAX_PER_PERSON * (city_land_price / 100) + jobs * TAX_PER_JOB * job_mult
    return round(base * (tax_rate / DEFAULT_TAX_RATE))


def upkeep_of(tiles: list[Tile], built: dict[str, float] | None = None) -> int:
    """年维护费 = Σ维护费 × 建成度（未建成的划区不产生运营成本）。"""
    ratios = built or {}
    return round(sum(t.upkeep * ratios.get(t.id, 1.0) for t in tiles))
