"""环境变量配置（06 §2）。

平衡参数（sim-config.yaml）在 PR-02/PR-06 落地；此处只放进程级配置。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CITY20_")

    app_version: str = "0.1.0"


def get_settings() -> Settings:
    return Settings()
