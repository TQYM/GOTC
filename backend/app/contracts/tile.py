"""Tile 已放置区块（02 §2.2），区块目录见 01 §3。"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class TileType(StrEnum):
    RES_LOW = "res_low"
    RES_MID = "res_mid"
    RES_HIGH = "res_high"
    COM_SHOP = "com_shop"
    COM_CBD = "com_cbd"
    IND_LIGHT = "ind_light"
    IND_HEAVY = "ind_heavy"
    GREEN_PARK = "green_park"
    GREEN_PLAZA = "green_plaza"
    EDU_SCHOOL = "edu_school"
    MED_CLINIC = "med_clinic"
    TRANS_METRO = "trans_metro"
    TRANS_ROAD = "trans_road"
    UTIL_BRIDGE = "util_bridge"


class Tile(BaseModel):
    id: str
    type: TileType
    anchor: list[int]  # [r, c]，多格区块的左上格（01 §3）
    cells: list[list[int]]  # 实际占格列表，前端渲染只信它（02 §2.2）
    orientation: Literal["horizontal", "vertical"] | None = None
    built_at_year: int = Field(ge=1)
    upkeep: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_bridge_orientation(self) -> "Tile":
        if self.type is TileType.UTIL_BRIDGE and self.orientation is None:
            raise ValueError("util_bridge 必须提供 orientation")
        if self.type is not TileType.UTIL_BRIDGE and self.orientation is not None:
            raise ValueError("只有 util_bridge 可以提供 orientation")
        return self

    @field_validator("anchor")
    @classmethod
    def _check_anchor(cls, v: list[int]) -> list[int]:
        if len(v) != 2 or any(not isinstance(x, int) or x < 0 for x in v):
            msg = "anchor 必须是 [r, c] 非负整数"
            raise ValueError(msg)
        return v

    @field_validator("cells")
    @classmethod
    def _check_cells(cls, v: list[list[int]]) -> list[list[int]]:
        if not v:
            msg = "cells 不能为空"
            raise ValueError(msg)
        bad = [c for c in v if len(c) != 2 or any(not isinstance(x, int) or x < 0 for x in c)]
        if bad:
            msg = f"cells 必须是 [r, c] 非负整数坐标列表，非法值: {bad}"
            raise ValueError(msg)
        return v


class PlaceRequest(BaseModel):
    type: TileType
    anchor: list[int]
    orientation: Literal["horizontal", "vertical"] | None = None

    @model_validator(mode="after")
    def _check_bridge_orientation(self) -> "PlaceRequest":
        if self.type is TileType.UTIL_BRIDGE and self.orientation is None:
            raise ValueError("util_bridge 必须提供 orientation")
        if self.type is not TileType.UTIL_BRIDGE and self.orientation is not None:
            raise ValueError("只有 util_bridge 可以提供 orientation")
        return self

    @field_validator("anchor")
    @classmethod
    def _check_anchor(cls, v: list[int]) -> list[int]:
        if len(v) != 2 or any(not isinstance(x, int) or x < 0 for x in v):
            msg = "anchor 必须是 [r, c] 非负整数"
            raise ValueError(msg)
        return v


class RemoveRequest(BaseModel):
    tile_id: str
