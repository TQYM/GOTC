"""不限时城市领域状态：完整快照、实际入住与共享年度步进。"""

from dataclasses import dataclass, field
from typing import Any

from app.config import SimConfig
from app.contracts.asset import ExistingAsset
from app.contracts.errors import ErrorCode
from app.contracts.finalize import ProjectionYear
from app.contracts.metrics import Phase
from app.contracts.parcel import Parcel, Terrain
from app.contracts.save import RedevelopmentResult
from app.contracts.tile import Tile
from app.core.errors import GameError
from app.core.session import GameSession
from app.sim import engine
from app.sim.events import EVENT_LABELS, modifier_for, roll_event
from app.sim.population import ResStat, residential_stats
from app.sim.projection import _year_events

MIGRATION_LIMIT = 0.08
EXODUS_THRESHOLD = 40
EXODUS_PENALTY = 0.05
RELOCATION_HAPPINESS_DELTA = -5
RELOCATION_PENALTY_YEARS = 3


@dataclass
class CityState(GameSession):
    """saves v2 状态；旧 GameSession 仅复用放置规则与 sim 组合，不启动任何 timer。"""

    city_code: str = ""
    name: str = "未命名城市"
    occupancy: dict[str, float] = field(default_factory=dict)
    existing_assets: dict[str, ExistingAsset] = field(default_factory=dict)
    redeveloped_asset_ids: set[str] = field(default_factory=set)
    relocation_penalty_until: int = 0
    low_happiness_streak: int = 0
    bankrupt: bool = False
    seq: int = 0
    rules_version: int = 2

    def __post_init__(self) -> None:
        # 不调用旧 __post_init__：资金为 0 是合法破产状态，不能被重置为初始资金。
        self.occupied = {}
        for tile in self.tiles.values():
            for row, col in tile.cells:
                self.occupied[(row, col)] = tile.id
        self._recompute()

    def _recompute(self) -> None:
        stats = self._stats_with_actual_occupancy()
        active = [
            asset for asset_id, asset in self.existing_assets.items()
            if asset_id not in self.redeveloped_asset_ids
        ]
        adjustment = (
            RELOCATION_HAPPINESS_DELTA
            if self.at_year < self.relocation_penalty_until else 0
        )
        self.metrics = engine.recompute(
            self.parcel,
            list(self.tiles.values()),
            self.config,
            funds=self.funds,
            at_year=self.at_year,
            at_phase=self.phase,
            stats_override=stats,
            modifier=modifier_for(self.current_event),
            existing_population=sum(asset.population for asset in active),
            existing_jobs=sum(asset.jobs for asset in active),
            existing_upkeep=sum(asset.upkeep for asset in active),
            happiness_adjustment=adjustment,
        )

    def _stats_with_actual_occupancy(self) -> list[ResStat]:
        targets = residential_stats(self.parcel, list(self.tiles.values()), self.config)
        target_ids = {stat.tile_id for stat in targets}
        self.occupancy = {
            tile_id: value for tile_id, value in self.occupancy.items() if tile_id in target_ids
        }
        return [
            ResStat(
                stat.tile_id,
                stat.anchor,
                stat.capacity,
                stat.attraction,
                self.occupancy.get(stat.tile_id, 0.0),
            )
            for stat in targets
        ]

    def _log_event(self, event: str, data: dict) -> None:
        # v2 的领域事件由 SaveService 在 SQLite 提交后发布；AI 事件仍复用此方法。
        if event in {"tick", "phase_change", "city_year", "finalize"}:
            return
        super()._log_event(event, data)

    def start_planning(self) -> None:
        if self.phase is Phase.BUILDING:
            return
        if self.phase is not Phase.BRIEFING:
            raise GameError(ErrorCode.INVALID_PHASE, "当前阶段不能开始规划")
        self.phase = Phase.BUILDING
        self._recompute()

    def _check_building(self) -> None:
        if self.phase is not Phase.BUILDING:
            raise GameError(
                ErrorCode.INVALID_PHASE,
                "请先开始规划",
                details={"phase": self.phase.value},
            )

    def advance_year(self) -> list[str]:
        """唯一的年度步进：在线 advance、project 与重放均调用此方法。"""
        self._check_building()
        before = self.metrics
        targets = residential_stats(self.parcel, list(self.tiles.values()), self.config)
        for target in targets:
            current = self.occupancy.get(target.tile_id, 0.0)
            delta = target.capacity * MIGRATION_LIMIT
            value = max(current - delta, min(current + delta, target.occupancy))
            if self.low_happiness_streak >= 2:
                value *= 1 - EXODUS_PENALTY
            self.occupancy[target.tile_id] = max(0.0, value)

        self.at_year += 1
        self.years_settled += 1
        self.current_event = roll_event(self.parcel.seed, self.at_year, self.cleared_forest)
        self._recompute()
        self.funds += self.metrics.tax_income - self.metrics.upkeep
        if self.funds < 0 and self.metrics.tax_income < self.metrics.upkeep * 0.8:
            self.bankrupt = True
        self.metrics = self.metrics.model_copy(update={"funds": self.funds})

        labels = _year_events(before, self.metrics)
        if self.current_event:
            labels = (labels + [EVENT_LABELS[self.current_event]])[:2]
        self.low_happiness_streak = (
            self.low_happiness_streak + 1
            if self.metrics.happiness < EXODUS_THRESHOLD
            else 0
        )
        return labels

    def redevelop(self, anchor: list[int]) -> RedevelopmentResult:
        self._check_building()
        if len(anchor) != 2 or any(
            not isinstance(value, int) or value < 0 or value >= self.parcel.size
            for value in anchor
        ):
            raise GameError(ErrorCode.INVALID_PLACEMENT, "更新坐标越界", {"anchor": anchor})
        coord = tuple(anchor)
        candidates = [
            asset for asset_id, asset in self.existing_assets.items()
            if asset_id not in self.redeveloped_asset_ids
            and any(tuple(cell) == coord for cell in asset.cells)
        ]
        if not candidates:
            raise GameError(
                ErrorCode.INVALID_PLACEMENT,
                "目标格没有可更新的现状资产",
                {"anchor": anchor},
            )
        # 重叠资产按稳定 id 选择；其他有效资产仍继续占据相应格。
        asset = sorted(candidates, key=lambda item: item.asset_id)[0]
        if self.funds < asset.demolition_cost:
            raise GameError(
                ErrorCode.INSUFFICIENT_FUNDS,
                "资金不足以完成更新改造",
                {
                    "needed": asset.demolition_cost,
                    "funds": self.funds,
                    "asset_id": asset.asset_id,
                },
            )
        self.funds -= asset.demolition_cost
        self.redeveloped_asset_ids.add(asset.asset_id)
        active_cells = {
            tuple(cell)
            for other_id, other in self.existing_assets.items()
            if other_id not in self.redeveloped_asset_ids
            for cell in other.cells
        }
        for cell in asset.cells:
            if tuple(cell) not in active_cells:
                row, col = cell
                self.parcel.terrain[row][col] = Terrain.FLAT
        self.relocation_penalty_until = max(
            self.relocation_penalty_until, self.at_year + RELOCATION_PENALTY_YEARS
        )
        self._recompute()
        return RedevelopmentResult(
            asset_id=asset.asset_id,
            cells=asset.cells,
            demolition_cost=asset.demolition_cost,
            population_removed=asset.population,
            jobs_removed=asset.jobs,
            happiness_delta=RELOCATION_HAPPINESS_DELTA,
            penalty_until_year=self.relocation_penalty_until,
        )

    def project(self, years: int) -> list[ProjectionYear]:
        """在完整快照副本上推演，不触碰在线对象或其 broadcaster。"""
        self._check_building()
        working = CityState.from_snapshot(self.to_snapshot())
        result: list[ProjectionYear] = []
        for _ in range(years):
            events = working.advance_year()
            preview_metrics = working.metrics.model_copy(update={"at_phase": Phase.PROJECTING})
            result.append(
                ProjectionYear(year=working.at_year, metrics=preview_metrics, events=events)
            )
        return result

    def to_snapshot(self) -> dict[str, Any]:
        return {
            "rules_version": self.rules_version,
            "session_id": self.session_id,
            "city_code": self.city_code,
            "name": self.name,
            "parcel": self.parcel.model_dump(mode="json"),
            "sim_config": self.config.model_dump(mode="json"),
            "funds": self.funds,
            "phase": self.phase.value,
            "at_year": self.at_year,
            "years_settled": self.years_settled,
            "placements_count": self.placements_count,
            "tiles": [tile.model_dump(mode="json") for tile in self.tiles.values()],
            "occupancy": self.occupancy,
            "existing_assets": {
                asset_id: asset.model_dump(mode="json")
                for asset_id, asset in self.existing_assets.items()
            },
            "redeveloped_asset_ids": sorted(self.redeveloped_asset_ids),
            "relocation_penalty_until": self.relocation_penalty_until,
            "current_event": self.current_event,
            "cleared_forest": self.cleared_forest,
            "low_happiness_streak": self.low_happiness_streak,
            "bankrupt": self.bankrupt,
            "seq": self.seq,
            "metrics": self.metrics.model_dump(mode="json"),
        }

    @classmethod
    def from_snapshot(
        cls, snapshot: dict[str, Any], config: SimConfig | None = None
    ) -> "CityState":
        sim_config = config or SimConfig.model_validate(snapshot["sim_config"])
        tiles = [Tile.model_validate(item) for item in snapshot.get("tiles", [])]
        assets = {
            asset_id: ExistingAsset.model_validate(item)
            for asset_id, item in snapshot.get("existing_assets", {}).items()
        }
        state = cls(
            session_id=snapshot["session_id"],
            city_code=snapshot["city_code"],
            name=snapshot["name"],
            parcel=Parcel.model_validate(snapshot["parcel"]),
            config=sim_config,
            funds=snapshot["funds"],
            phase=Phase(snapshot["phase"]),
            at_year=snapshot["at_year"],
            years_settled=snapshot.get("years_settled", 0),
            placements_count=snapshot.get("placements_count", 0),
            tiles={tile.id: tile for tile in tiles},
            occupancy={key: float(value) for key, value in snapshot.get("occupancy", {}).items()},
            existing_assets=assets,
            redeveloped_asset_ids=set(snapshot.get("redeveloped_asset_ids", [])),
            relocation_penalty_until=snapshot.get("relocation_penalty_until", 0),
            current_event=snapshot.get("current_event"),
            cleared_forest=snapshot.get("cleared_forest", False),
            low_happiness_streak=snapshot.get("low_happiness_streak", 0),
            bankrupt=snapshot.get("bankrupt", False),
            seq=snapshot.get("seq", 0),
            rules_version=snapshot.get("rules_version", 2),
        )
        return state
