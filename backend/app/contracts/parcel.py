"""Parcel 地块（02 §2.1），地形枚举见 01 §2。"""

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class Terrain(StrEnum):
    FLAT = "flat"
    HILL = "hill"
    RIVER = "river"
    BANK = "bank"
    FOREST = "forest"
    ROAD_INHERITED = "road_inherited"


class ParcelConstraints(BaseModel):
    height_limit_m: int = Field(ge=1)
    green_line_m: int = Field(ge=0)
    buildable_ratio: float = Field(ge=0.0, le=1.0)
    briefing: str


def _check_coord(coord: list[int]) -> bool:
    return len(coord) == 2 and all(isinstance(v, int) and v >= 0 for v in coord)


class Parcel(BaseModel):
    size: int = Field(default=48, ge=1)
    cell_size_m: int = Field(default=50, ge=1)
    terrain: list[list[Terrain]]
    inherited_road: list[list[int]]
    constraints: ParcelConstraints
    seed: int

    @model_validator(mode="after")
    def _check_geometry(self) -> "Parcel":
        if len(self.terrain) != self.size:
            msg = f"terrain 行数 {len(self.terrain)} != size {self.size}"
            raise ValueError(msg)
        if any(len(row) != self.size for row in self.terrain):
            msg = "terrain 每行长度必须等于 size（方形棋盘，01 §1）"
            raise ValueError(msg)
        if any(not _check_coord(c) for c in self.inherited_road):
            msg = "inherited_road 必须是 [r, c] 非负整数坐标列表"
            raise ValueError(msg)
        return self


class CreateSessionRequest(BaseModel):
    seed: int | None = None
