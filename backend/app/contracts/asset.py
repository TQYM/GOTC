"""真实片区既有建筑资产与路网数据。"""

from pydantic import BaseModel, Field


class ExistingAsset(BaseModel):
    asset_id: str
    name: str | None = None
    category: str
    height_m: float = Field(gt=0)
    levels: float = Field(gt=0)
    footprint: list[list[float]] = Field(default_factory=list)
    cells: list[list[int]]
    base_area_m2: float = Field(ge=0)
    population: int = Field(default=0, ge=0)
    jobs: int = Field(default=0, ge=0)
    demolition_cost: int = Field(default=0, ge=0)
    upkeep: int = Field(default=0, ge=0)
    height_source: str = "default-levels"


class BuildingsFile(BaseModel):
    parcel_id: str
    data_version: str
    chunks: dict[str, list[ExistingAsset]]


class NetworkFeature(BaseModel):
    feature_id: str
    kind: str
    highway: str | None = None
    path: list[list[float]]


class NetworkFile(BaseModel):
    parcel_id: str
    data_version: str
    features: list[NetworkFeature]
