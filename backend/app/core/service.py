"""saves v2 应用服务：per-save 串行、事务提交后广播、AI 异步降级。"""

import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import Settings, SimConfig, get_settings, load_sim_config
from app.contracts.common import Source
from app.contracts.errors import ErrorCode
from app.contracts.finalize import FinalizeResult
from app.contracts.metrics import Phase
from app.contracts.save import (
    CreateSaveRequest,
    OperationResult,
    ProjectionResult,
    RedevelopmentResult,
    ReportResult,
    SaveState,
)
from app.contracts.tile import TileType
from app.core.broadcaster import Broadcaster
from app.core.city import CityState
from app.core.errors import GameError
from app.core.report import build_template_report
from app.core.repository import SaveRepository, utc_now
from app.narrate.router import Narrator, schedule_news
from app.sim import engine
from app.sim.parcel_loader import load_city
from app.sim.population import capacity_of
from app.sim.projection import determine_ending, scores_of

CITY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


@dataclass
class SaveRuntime:
    record: dict[str, Any]
    state: CityState
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    broadcaster: Broadcaster = field(
        default_factory=lambda: Broadcaster(start_id=int(time.time() * 1000))
    )


class SaveService:
    def __init__(
        self,
        repository: SaveRepository,
        *,
        config: SimConfig | None = None,
        settings: Settings | None = None,
        narrator: Narrator | None = None,
    ) -> None:
        self.repository = repository
        self.config = config or load_sim_config()
        self.settings = settings or get_settings()
        self.narrator = narrator or Narrator(self.settings)
        self._runtimes: dict[str, SaveRuntime] = {}
        self._runtime_lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[Any]] = set()

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> "SaveService":
        settings = settings or get_settings()
        return cls(
            SaveRepository(
                Path(settings.database_path), snapshot_interval=settings.snapshot_interval
            ),
            settings=settings,
        )

    async def initialize(self) -> None:
        await self.repository.initialize()

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.repository.close()
        self._runtimes.clear()

    def _spawn(self, coroutine: Any) -> None:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @staticmethod
    def _not_found(city_code: str) -> GameError:
        return GameError(
            ErrorCode.SESSION_NOT_FOUND,
            "城市码不存在",
            {"city_code": city_code},
        )

    async def _new_city_code(self) -> str:
        for _ in range(20):
            code = "".join(secrets.choice(CITY_ALPHABET) for _ in range(8))
            if await self.repository.get_record(code) is None:
                return code
        raise RuntimeError("无法分配唯一城市码")

    async def create(self, request: CreateSaveRequest) -> SaveState:
        code = await self._new_city_code()
        save_id = "sav_" + secrets.token_hex(8)
        default_names = {
            "beijing_cbd": "朝阳 CBD 更新计划",
            "beijing_core": "东西朝海城市更新",
        }
        name = (request.name or "").strip() or default_names.get(request.parcel_id, "我的沙盒城市")
        state = load_city(
            save_id=save_id,
            city_code=code,
            name=name,
            parcel_id=request.parcel_id,
            seed=request.seed,
            data_dir=self.settings.parcel_data_dir,
            config=self.config,
        )
        record = {
            "save_id": save_id,
            "city_code": code,
            "name": name,
            "seed": state.parcel.seed,
            "parcel_id": state.parcel.parcel_id,
            "data_version": state.parcel.data_version,
        }
        await self.repository.create_save(
            record=record, snapshot=state.to_snapshot(), created_at=utc_now()
        )
        runtime = SaveRuntime(record=record, state=state)
        state.lock = runtime.lock
        state.broadcaster = runtime.broadcaster
        self._runtimes[code] = runtime
        return self._state_view(runtime)

    async def _runtime(self, city_code: str) -> SaveRuntime:
        code = city_code.upper()
        cached = self._runtimes.get(code)
        if cached is not None:
            return cached
        async with self._runtime_lock:
            cached = self._runtimes.get(code)
            if cached is not None:
                return cached
            loaded = await self.repository.load_state(code)
            if loaded is None:
                raise self._not_found(code)
            record, snapshot, op_rows = loaded
            state = CityState.from_snapshot(snapshot)
            # start 不写 op：即使最近快照仍是 seq=0 briefing，也要先恢复当前阶段再重放。
            state.phase = Phase(record["phase"])
            state._recompute()
            for row in op_rows:
                self._apply_domain(
                    state,
                    row["op_type"],
                    json.loads(row["payload_json"]),
                    row["seq"],
                )
                state.seq = row["seq"]
            # start 不产生 op；saves 元数据覆盖最近快照里的旧 phase。
            state.phase = Phase(record["phase"])
            state.at_year = record["city_year"]
            state.seq = record["last_seq"]
            state._recompute()
            runtime = SaveRuntime(record=record, state=state)
            state.lock = runtime.lock
            state.broadcaster = runtime.broadcaster
            self._runtimes[code] = runtime
            return runtime

    @staticmethod
    def _state_view(runtime: SaveRuntime) -> SaveState:
        state = runtime.state
        return SaveState(
            save_id=state.session_id,
            city_code=state.city_code,
            name=state.name,
            parcel=state.parcel,
            tiles=list(state.tiles.values()),
            redeveloped_asset_ids=sorted(state.redeveloped_asset_ids),
            metrics=state.metrics,
            city_year=state.at_year,
            phase=state.phase,
            last_seq=state.seq,
        )

    async def get(self, city_code: str) -> SaveState:
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            return self._state_view(runtime)

    async def start(self, city_code: str) -> SaveState:
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            working = CityState.from_snapshot(runtime.state.to_snapshot())
            working.start_planning()
            await self.repository.update_phase(
                runtime.record["save_id"], working.phase.value, working.at_year
            )
            working.seq = runtime.state.seq
            self._install_working(runtime, working)
            result = self._state_view(runtime)
        runtime.broadcaster.publish(
            "phase_change", {"phase": result.phase.value, "city_year": result.city_year}
        )
        return result

    @staticmethod
    def _install_working(runtime: SaveRuntime, working: CityState) -> None:
        working.lock = runtime.lock
        working.broadcaster = runtime.broadcaster
        runtime.state = working

    @staticmethod
    def _apply_domain(
        state: CityState, op_type: str, payload: dict[str, Any], seq: int
    ) -> tuple[Any, list[str], RedevelopmentResult | None]:
        if op_type == "place":
            tile, _metrics, _diff, _funds = state.place(
                TileType(payload["type"]),
                payload["anchor"],
                orientation=payload.get("orientation"),
                tile_id=f"tile_{seq:08d}",
            )
            return tile, [], None
        if op_type == "remove":
            tile, _metrics, _diff, _funds = state.remove(payload["tile_id"])
            return tile, [], None
        if op_type == "advance":
            return None, state.advance_year(), None
        if op_type == "redevelop":
            return None, [], state.redevelop(payload["anchor"])
        raise RuntimeError(f"未知 op_type: {op_type}")

    async def apply(
        self,
        city_code: str,
        op_type: str,
        *,
        client_op_id: str,
        payload: dict[str, Any],
    ) -> OperationResult:
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            existing = await self.repository.get_operation(
                runtime.record["save_id"], client_op_id
            )
            if existing is not None:
                return OperationResult.model_validate_json(existing["result_json"])

            before = runtime.state.metrics
            working = CityState.from_snapshot(runtime.state.to_snapshot())
            seq = runtime.state.seq + 1
            tile, annual_events, redevelopment = self._apply_domain(
                working, op_type, payload, seq
            )
            working.seq = seq
            diff = engine.metrics_diff(before, working.metrics).model_copy(
                update={"after": working.metrics}
            )
            result = OperationResult(
                seq=seq,
                op_type=op_type,
                client_op_id=client_op_id,
                payload=payload,
                tile=tile if op_type in ("place", "remove") else None,
                tiles=list(working.tiles.values()),
                redeveloped_asset_ids=sorted(working.redeveloped_asset_ids),
                redevelopment=redevelopment,
                metrics=working.metrics,
                metrics_diff=diff,
                funds_after=working.funds,
                city_year=working.at_year,
                annual_events=annual_events,
            )
            committed, raw_result = await self.repository.append_operation(
                save_id=runtime.record["save_id"],
                expected_seq=seq,
                op_type=op_type,
                payload=payload,
                result=result.model_dump(mode="json"),
                client_op_id=client_op_id,
                snapshot=working.to_snapshot(),
            )
            if not committed:
                return OperationResult.model_validate(raw_result)
            self._install_working(runtime, working)

        runtime.broadcaster.publish("op_applied", result.model_dump(mode="json"))
        if op_type == "advance":
            runtime.broadcaster.publish("city_year", result.model_dump(mode="json"))
        cause = tile.type.value if tile is not None else op_type
        anchor = tile.anchor if tile is not None else payload.get("anchor")
        schedule_news(working, before, working.metrics, cause, self.narrator, anchor)
        # 04 §4：前 20 个领域 op 每 5 个，之后每 10 个；只读/叙事请求不占 seq。
        if seq > 0 and seq % (5 if seq <= 20 else 10) == 0:
            self._spawn(self.narrator.mentor_comment(working))
        return result

    async def project(self, city_code: str, years: int) -> ProjectionResult:
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            state = runtime.state
            state._check_building()
            result = ProjectionResult(
                projection_id="prj_" + secrets.token_hex(8),
                base_year=state.at_year,
                base_seq=state.seq,
                projection=state.project(years),
            )
        for step in result.projection:
            runtime.broadcaster.publish(
                "projection_step",
                {
                    **step.model_dump(mode="json"),
                    "projection_id": result.projection_id,
                    "base_year": result.base_year,
                    "base_seq": result.base_seq,
                },
            )
        return result

    async def report(self, city_code: str) -> ReportResult:
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            state = runtime.state
            state._check_building()
            res_capacity = sum(
                capacity_of(tile.type, state.config)
                for tile in state.tiles.values()
                if tile.type in (TileType.RES_LOW, TileType.RES_MID, TileType.RES_HIGH)
            )
            industry_count = sum(
                tile.type in (TileType.IND_LIGHT, TileType.IND_HEAVY)
                for tile in state.tiles.values()
            )
            ending = determine_ending(
                state.metrics,
                bankrupt=state.bankrupt,
                res_capacity=res_capacity,
                industry_count=industry_count,
            )
            scores = scores_of(state.metrics, res_capacity)
            report = ReportResult(
                report_id="rpt_" + secrets.token_hex(8),
                created_at=utc_now(),
                base_year=state.at_year,
                base_seq=state.seq,
                scores=scores,
                ending=ending,
                report=build_template_report(state.name, state.metrics, scores, ending),
                city_name=state.name,
                city_name_source=Source.TEMPLATE,
            )
            await self.repository.add_report(
                state.session_id, report.model_dump(mode="json")
            )
        runtime.broadcaster.publish("report_ready", report.model_dump(mode="json"))
        if self.narrator.llm.available:
            self._spawn(self._improve_report(runtime, report))
        return report

    async def _improve_report(self, runtime: SaveRuntime, report: ReportResult) -> None:
        interim = FinalizeResult(
            projection=[{"year": report.base_year, "metrics": runtime.state.metrics}],
            ending=report.ending,
            scores=report.scores,
            report=report.report,
            city_name=report.city_name,
            city_name_source=report.city_name_source,
        )
        improved = await self.narrator.ai_report(runtime.state, interim)
        if improved is None:
            return
        updated = report.model_copy(update={"report": improved, "city_name_source": Source.AI})
        await self.repository.update_report(
            runtime.record["save_id"], updated.model_dump(mode="json")
        )
        runtime.broadcaster.publish("report_ready", updated.model_dump(mode="json"))

    async def reports(self, city_code: str) -> list[ReportResult]:
        runtime = await self._runtime(city_code)
        rows = await self.repository.list_reports(runtime.record["save_id"])
        return [ReportResult.model_validate(row) for row in rows]

    async def mentor(self, city_code: str) -> None:
        runtime = await self._runtime(city_code)
        runtime.state._check_building()
        self._spawn(self.narrator.mentor_comment(runtime.state, force=True))
