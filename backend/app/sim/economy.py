"""财政（03 §4.11/4.12）与岗位（03 §4.3/4.4）。"""

from app.config import SimConfig
from app.contracts.tile import Tile, TileType
from app.sim.population import ResStat

# 税率常量（03 §4.11；未列入 §8 配置表，调参需同步文档）
TAX_PER_PERSON = 1200  # 元/人·年
TAX_PER_JOB = 500  # 元/岗·年


def jobs_of(tiles: list[Tile], config: SimConfig) -> int:
    """jobs = Σ岗位；岗位在放置瞬间即满（03 §4.3）。"""
    emp = config.employment
    table = {
        TileType.COM_SHOP: emp.jobs_shop,
        TileType.COM_CBD: emp.jobs_cbd,
        TileType.IND_LIGHT: emp.jobs_light,
        TileType.IND_HEAVY: emp.jobs_heavy,
    }
    return sum(table.get(t.type, 0) for t in tiles)


def job_res_ratio(jobs: int, population: int) -> float:
    """职住比 = jobs ÷ population（03 §4.4）；无人口时定义为 0（避免除零）。"""
    if population <= 0:
        return 0.0
    return round(jobs / population, 4)


def tax_income(
    stats: list[ResStat], jobs: int, city_land_price: float, job_mult: float = 1.0
) -> int:
    """年税收 = Σ住宅入住×1200×(地价指数/100) + Σ岗位×500（03 §4.11）。

    job_mult：环境事件「产业风口」岗位税 +20%（03 §7）。
    """
    population = sum(s.occupancy for s in stats)
    return round(
        population * TAX_PER_PERSON * (city_land_price / 100) + jobs * TAX_PER_JOB * job_mult
    )


def upkeep_of(tiles: list[Tile]) -> int:
    """年维护费 = Σ各区块维护费（03 §4.12），与是否入住无关。"""
    return sum(t.upkeep for t in tiles)
