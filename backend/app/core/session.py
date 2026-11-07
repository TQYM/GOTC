"""会话对象（06 §3）：一局游戏的全过程状态。

PR-06 起 place/remove 接真引擎（03 §4.1–4.6、4.11、4.12 全量重算）；
失败响应附最新 metrics 与 funds_after（02 §3.3）；
finalize 仍为桩推演（真 10 年推演随 PR-08 落地）。
"""

import asyncio
import secrets
import time
from dataclasses import dataclass, field

from app.config import SimConfig
from app.contracts.errors import ErrorCode
from app.contracts.finalize import Ending, FinalizeResult, ProjectionYear, Scores
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import Parcel, Terrain
from app.contracts.tile import Tile, TileType
from app.core.errors import GameError
from app.sim import engine
from app.sim.catalog import CATALOG, GREEN_TYPES, expand_cells, placement_cost

TILE_ID_PREFIX = "tile_"
# 放置校验允许的地形（01 §2）；bank 仅绿地类区块可放；forest 视为可建设（铲除触发抗议，03 §7）
_BUILDABLE = {Terrain.FLAT, Terrain.HILL, Terrain.FOREST}
_BANK_ALLOWED = GREEN_TYPES


@dataclass
class GameSession:
    session_id: str
    parcel: Parcel
    config: SimConfig
    phase: Phase = Phase.BRIEFING
    time_left_sec: int = 20  # 02 §3.1：briefing 20s
    funds: int = 0
    placements_count: int = 0
    tiles: dict[str, Tile] = field(default_factory=dict)
    occupied: dict[tuple[int, int], str] = field(default_factory=dict)
    metrics: Metrics | None = None
    finalized: bool = False
    finalize_result: FinalizeResult | None = None
    created_at: float = field(default_factory=time.monotonic)
    last_active: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        if self.funds == 0:
            self.funds = self.config.economy.initial_funds
        self._recompute()

    # ---- 引擎 ----

    def _recompute(self) -> None:
        """全量重算并缓存（03 §1：每次操作后从头算一遍）。"""
        self.metrics = engine.recompute(
            self.parcel,
            list(self.tiles.values()),
            self.config,
            funds=self.funds,
            at_phase=self.phase,
        )

    def _attach_state_to_error(self, exc: GameError) -> GameError:
        """02 §3.3：失败响应附最新 metrics 与 funds_after。"""
        details = dict(exc.details or {})
        details["metrics"] = self.metrics.model_dump() if self.metrics else None
        details["funds_after"] = self.funds
        exc.details = details
        return exc

    # ---- 校验（03 §3 流程） ----

    def _touch(self) -> None:
        self.last_active = time.monotonic()

    def _check_phase(self) -> None:
        if self.phase not in (Phase.BUILD, Phase.POLISH):
            raise GameError(
                ErrorCode.INVALID_PHASE,
                f"当前阶段 {self.phase.value} 不允许放置/拆除",
                details={"phase": self.phase.value},
            )

    def _terrain_at(self, r: int, c: int) -> Terrain:
        return self.parcel.terrain[r][c]

    def _check_cells_placeable(self, tile_type: TileType, cells: list[list[int]]) -> None:
        size = self.parcel.size
        oob = [[r, c] for r, c in cells if not (0 <= r < size and 0 <= c < size)]
        if oob:
            raise GameError(
                ErrorCode.INVALID_PLACEMENT,
                "锚点覆盖格越界",
                details={"cells": oob},
            )
        blocked: list[list[int]] = []
        for r, c in cells:
            t = self._terrain_at(r, c)
            if t in _BUILDABLE:
                continue
            if t is Terrain.BANK and tile_type in _BANK_ALLOWED:
                continue
            blocked.append([r, c])
        if blocked:
            reasons = {self._terrain_at(r, c).value for r, c in blocked}
            raise GameError(
                ErrorCode.INVALID_PLACEMENT,
                f"目标格子不可建设（terrain={','.join(sorted(reasons))}）",
                details={"cells": blocked},
            )
        taken = [[r, c] for r, c in cells if (r, c) in self.occupied]
        if taken:
            raise GameError(
                ErrorCode.CELL_OCCUPIED,
                "目标格已有区块",
                details={"cells": taken},
            )

    def _check_funds(self, cost: int) -> None:
        if cost > self.funds:
            raise GameError(
                ErrorCode.INSUFFICIENT_FUNDS,
                f"财政资金不足（需 {cost}，余 {self.funds}）",
                details={"cost": cost, "funds": self.funds},
            )

    # ---- 操作 ----

    def place(
        self, tile_type: TileType, anchor: list[int]
    ) -> tuple[Tile, Metrics, MetricsDiff, int]:
        self._touch()
        try:
            self._check_phase()
            cells = expand_cells(tile_type, anchor)
            self._check_cells_placeable(tile_type, cells)
            cost = placement_cost(tile_type, cells, self.parcel.terrain)
            self._check_funds(cost)
        except GameError as exc:
            raise self._attach_state_to_error(exc) from exc

        before = self.metrics
        self.funds -= cost
        tile = Tile(
            id=TILE_ID_PREFIX + secrets.token_hex(4),
            type=tile_type,
            anchor=list(anchor),
            cells=cells,
            built_at_year=1,
            upkeep=(
                CATALOG[tile_type].upkeep * len(cells)  # 桥按格数计维护（03 §8 bridge 10k×N）
                if tile_type is TileType.UTIL_BRIDGE
                else CATALOG[tile_type].upkeep
            ),
        )
        self.tiles[tile.id] = tile
        for r, c in cells:
            self.occupied[(r, c)] = tile.id
        self.placements_count += 1
        self._recompute()
        return tile, self.metrics, engine.metrics_diff(before, self.metrics), self.funds

    def remove(self, tile_id: str) -> tuple[Tile, Metrics, MetricsDiff, int]:
        self._touch()
        try:
            self._check_phase()
            tile = self.tiles.get(tile_id)
            if tile is None:
                raise GameError(
                    ErrorCode.INVALID_PLACEMENT,
                    f"区块 {tile_id} 不存在",
                    details={"tile_id": tile_id},
                )
        except GameError as exc:
            raise self._attach_state_to_error(exc) from exc
        cost = placement_cost(tile.type, tile.cells, self.parcel.terrain)
        refund = -(-cost * int(self.config.economy.demolish_refund * 100) // 100)  # ceil(cost×0.3)
        before = self.metrics
        self.funds += refund
        for r, c in tile.cells:
            self.occupied.pop((r, c), None)
        del self.tiles[tile_id]
        self._recompute()
        return tile, self.metrics, engine.metrics_diff(before, self.metrics), self.funds

    def advance(self) -> tuple[Phase, int]:
        self._touch()
        if self.phase is Phase.BRIEFING:
            self.phase = Phase.BUILD
            self.time_left_sec = self.config.economy.build_minutes * 60
            self._recompute()
            return self.phase, self.time_left_sec
        raise GameError(
            ErrorCode.INVALID_PHASE,
            f"阶段 {self.phase.value} 不支持 advance（锁定请用 finalize）",
            details={"phase": self.phase.value},
        )

    def finalize(self) -> FinalizeResult:
        self._touch()
        if self.finalized and self.finalize_result is not None:
            return self.finalize_result  # 幂等（06 §6）
        if self.phase not in (Phase.BUILD, Phase.POLISH):
            raise GameError(
                ErrorCode.INVALID_PHASE,
                f"当前阶段 {self.phase.value} 不可推演",
                details={"phase": self.phase.value},
            )
        self.phase = Phase.LOCKED
        self.time_left_sec = 0
        self._recompute()
        self.finalize_result = self._stub_finalize()
        self.finalized = True
        return self.finalize_result

    # ---- 桩推演（PR-08 由真 10 年快进替换） ----

    def _stub_finalize(self) -> FinalizeResult:
        base = self.metrics
        projection = [
            ProjectionYear(year=year, metrics=base, events=[] if year % 3 else ["人口流入放缓"])
            for year in range(4, 4 + self.config.economy.projection_years)
        ]
        return FinalizeResult(
            phase=Phase.LOCKED,
            projection=projection,
            ending=Ending.ORDINARY,
            scores=Scores(population=50, balance=50, green=50, traffic=50, happiness=50),
            report_text="（桩）推演报告文案占位：PR-12 接入规划导师叙事。",
        )
