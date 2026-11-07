"""会话对象（06 §3）：一局游戏的全过程状态。

PR-06/07 接真引擎；PR-08 落地年度结算（03 §5）、环境事件（03 §7）、
阶段调度（core/timer.py 每秒驱动 timer_tick）与真 10 年推演（03 §6）。
"""

import asyncio
import secrets
import time
from dataclasses import dataclass, field

from app.config import SimConfig
from app.contracts.common import Source
from app.contracts.errors import ErrorCode
from app.contracts.events import Report, ReportDimensions
from app.contracts.finalize import FinalizeResult
from app.contracts.metrics import Metrics, MetricsDiff, Phase
from app.contracts.parcel import Parcel, Terrain
from app.contracts.tile import Tile, TileType
from app.core.errors import GameError
from app.sim import engine
from app.sim.catalog import CATALOG, GREEN_TYPES, bridge_cells, expand_cells, placement_cost
from app.sim.events import modifier_for, roll_event
from app.sim.projection import run_projection

CITY_NAMES = ("江湾市", "云州市", "临川市", "南星市", "北湾市", "青梧市")
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
    projection_published_year: int = 0  # 02 §3.2：SSE 已播放到第几年（PR-13 推进）
    at_year: int = 1
    cleared_forest: bool = False  # 铲过森林 → 林地抗议入事件池（03 §7）
    current_event: str | None = None  # 当年环境事件（03 §7，一年期）
    years_settled: int = 0
    phase_started_at: float = field(default_factory=time.monotonic)
    event_log: list[dict] = field(default_factory=list)  # PR-13 换环形缓冲
    closed: bool = False  # 被 store 清扫后置位，timer 退出
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
            at_year=self.at_year,
            at_phase=self.phase,
            modifier=modifier_for(self.current_event),
        )

    def _log_event(self, event: str, data: dict) -> None:
        """事件流水（02 §2；PR-13 由 SSE 网关消费）。"""
        self.event_log.append({"id": len(self.event_log) + 1, "event": event, "data": data})

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
            if tile_type is TileType.UTIL_BRIDGE:
                # 跨河桥特判（01 §3）：锚点必须在河道，覆盖整段连续河面，不做常用地形校验
                try:
                    cells = bridge_cells(self.parcel, anchor)
                except ValueError as exc:
                    raise GameError(ErrorCode.INVALID_PLACEMENT, str(exc)) from exc
                taken = [[r, c] for r, c in cells if (r, c) in self.occupied]
                if taken:
                    raise GameError(
                        ErrorCode.CELL_OCCUPIED, "桥位已被占用", details={"cells": taken}
                    )
            else:
                cells = expand_cells(tile_type, anchor)
                self._check_cells_placeable(tile_type, cells)
            cost = placement_cost(tile_type, cells, self.parcel.terrain)
            self._check_funds(cost)
        except GameError as exc:
            raise self._attach_state_to_error(exc) from exc

        before = self.metrics
        self.funds -= cost
        if tile_type not in GREEN_TYPES and any(
            self.parcel.terrain[r][c] is Terrain.FOREST for r, c in cells
        ):
            self.cleared_forest = True  # 铲森林 → 林地抗议入池（03 §7）
        orientation = None
        if tile_type is TileType.UTIL_BRIDGE:
            # 02 §2.2：桥必带朝向；同行=horizontal，同列=vertical
            orientation = "horizontal" if len({r for r, _ in cells}) == 1 else "vertical"
        tile = Tile(
            id=TILE_ID_PREFIX + secrets.token_hex(4),
            type=tile_type,
            anchor=list(anchor),
            cells=cells,
            orientation=orientation,
            built_at_year=self.at_year,
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
            self._enter_build(time.monotonic())
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
        outcome = run_projection(
            self.parcel,
            list(self.tiles.values()),
            self.config,
            funds=self.funds,
            start_year=self.at_year,
            cleared_forest=self.cleared_forest,
        )
        city_name = CITY_NAMES[self.parcel.seed % len(CITY_NAMES)]
        report = Report(  # PR-12 换规划导师完整三段式（AI 可改写并标 source=ai）
            overview=f"{city_name}走过了十个年头。总体诊断详版由规划导师在 PR-12 生成。",
            dimensions=ReportDimensions(
                population=f"人口 {outcome.projection[-1].metrics.population}。",
                balance=f"职住比 {outcome.projection[-1].metrics.job_res_ratio}。",
                green=f"绿地率 {outcome.projection[-1].metrics.green_ratio:.0%}。",
                traffic=f"平均通勤 {outcome.projection[-1].metrics.avg_commute} 分钟。",
                happiness=f"幸福度 {outcome.projection[-1].metrics.happiness}。",
            ),
            ending_story=f"结局：{outcome.ending.value}。完整故事由规划导师在 PR-12 生成。",
            source=Source.TEMPLATE,
        )
        self.finalize_result = FinalizeResult(
            phase=Phase.LOCKED,
            projection=outcome.projection,
            ending=outcome.ending,
            scores=outcome.scores,
            report=report,
            city_name=city_name,
            city_name_source=Source.TEMPLATE,
        )
        self.finalized = True
        self._log_event("finalize", self.finalize_result.model_dump(mode="json"))
        return self.finalize_result

    # ---- 年度结算与阶段调度（03 §5；core/timer.py 每秒驱动） ----

    def _enter_build(self, now: float) -> None:
        self.phase = Phase.BUILD
        self.phase_started_at = now
        self.years_settled = 0
        self.time_left_sec = 3 * self.config.economy.year_seconds
        self._recompute()
        self._log_event("phase_change", {"to": "build", "year": self.at_year})

    def _enter_polish(self, now: float) -> None:
        self.phase = Phase.POLISH
        self.phase_started_at = now
        self.time_left_sec = self.config.economy.polish_minutes * 60
        self._recompute()
        self._log_event("phase_change", {"to": "polish", "year": self.at_year})

    def settle_year(self) -> tuple[Metrics, str | None]:
        """年末结算（03 §5）：资金 ±、人口再平衡（全量重算）、5% 环境事件。"""
        before = self.metrics
        self.funds += before.tax_income - before.upkeep
        self.at_year += 1
        self.years_settled += 1
        self.current_event = roll_event(self.parcel.seed, self.at_year, self.cleared_forest)
        self._recompute()
        self._log_event(
            "tick",
            {
                "year": self.at_year,
                "metrics": self.metrics.model_dump(mode="json"),
                "metrics_diff": engine.metrics_diff(before, self.metrics).model_dump(mode="json"),
                "event": self.current_event,
            },
        )
        return self.metrics, self.current_event

    def timer_tick(self, now: float | None = None) -> None:
        """每秒由 timer 调用：阶段自动推进 + 年度结算 + 倒计时刷新。

        briefing 20s → build 3×year_seconds（每年结算一次）→ polish 120s → 自动 finalize。
        """
        if self.finalized or self.closed:
            return
        now = now if now is not None else time.monotonic()
        eco = self.config.economy
        elapsed = now - self.phase_started_at
        if self.phase is Phase.BRIEFING:
            self.time_left_sec = max(0, round(eco.briefing_sec - elapsed))
            if elapsed >= eco.briefing_sec:
                self._enter_build(now)
        elif self.phase is Phase.BUILD:
            build_seconds = 3 * eco.year_seconds
            self.time_left_sec = max(0, round(build_seconds - elapsed))
            while self.years_settled < 3 and elapsed >= (self.years_settled + 1) * eco.year_seconds:
                self.settle_year()
            if elapsed >= build_seconds:
                self._enter_polish(now)
        elif self.phase is Phase.POLISH:
            self.time_left_sec = max(0, round(eco.polish_minutes * 60 - elapsed))
            if elapsed >= eco.polish_minutes * 60:
                self.finalize()
