"""环境变量 + 参数文件加载（06 §2）。

sim-config.yaml 是 03 §8 参数表的唯一落盘出处；调参只改 YAML，不改逻辑。
"""

from pathlib import Path

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SIM_CONFIG_PATH = Path(__file__).resolve().parent.parent / "sim-config.yaml"


class Settings(BaseSettings):
    """进程级环境变量配置。"""

    model_config = SettingsConfigDict(env_prefix="CITY20_")

    app_version: str = "0.1.0"


class GenerationConfig(BaseModel):
    """03 §2 世界生成参数。"""

    river_target_pct: tuple[float, float]
    hill_target_pct: tuple[float, float]
    forest_target_pct: tuple[float, float]
    buildable_ratio_min: float = Field(ge=0.0, le=1.0)
    max_regen_attempts: int = Field(ge=1)
    river_width_min: int = Field(ge=1)
    river_width_max: int = Field(ge=1)
    hill_clusters: tuple[int, int]
    hill_radius: tuple[float, float]
    forest_patches: tuple[int, int]
    forest_radius: tuple[float, float]
    forest_edge_bias: float = Field(ge=0.0, le=1.0)
    height_limit_m: tuple[int, int]
    green_line_m: int = Field(ge=0)


class EconomyConfig(BaseModel):
    """03 §8 经济与阶段参数。"""

    initial_funds: int = Field(ge=0)
    demolish_refund: float = Field(ge=0.0, le=1.0)
    build_minutes: int = Field(ge=1)
    polish_minutes: int = Field(ge=1)
    briefing_sec: int = Field(ge=1)
    projection_years: int = Field(ge=1)


class ResidentialConfig(BaseModel):
    """03 §8 住宅容量（人/座）。"""

    capacity_res_low: int = Field(ge=0)
    capacity_res_mid: int = Field(ge=0)
    capacity_res_high: int = Field(ge=0)


class EmploymentConfig(BaseModel):
    """03 §8 岗位数（岗/座）。"""

    jobs_shop: int = Field(ge=0)
    jobs_cbd: int = Field(ge=0)
    jobs_light: int = Field(ge=0)
    jobs_heavy: int = Field(ge=0)


class SimConfig(BaseModel):
    """03 §8 参数表。"""

    grid_size: int = Field(default=48, ge=1)
    cell_size_m: int = Field(default=50, ge=1)
    generation: GenerationConfig
    economy: EconomyConfig
    residential: ResidentialConfig
    employment: EmploymentConfig
    briefing_template: str


def get_settings() -> Settings:
    return Settings()


def load_sim_config(path: Path | None = None) -> SimConfig:
    config_path = path or SIM_CONFIG_PATH
    data = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    return SimConfig.model_validate(data)
