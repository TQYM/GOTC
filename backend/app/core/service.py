"""saves v2 应用服务：per-save 串行、事务提交后广播、AI 异步降级。"""

import asyncio
import json
import logging
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
from app.sim.demand import Demand
from app.sim.districts import POLICIES
from app.sim.milestones import milestone_view
from app.sim.policies import CITY_POLICIES, policy_list
from app.sim.parcel_loader import load_city
from app.sim.population import RES_TYPES as _RES_TYPES
from app.sim.population import capacity_of
from app.sim.traffic import JOB_TYPES as _JOB_TYPES
from app.sim.transit import LINE_KINDS
from app.sim.projection import determine_ending, scores_of

CITY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
log = logging.getLogger(__name__)


@dataclass
class SaveRuntime:
    record: dict[str, Any]
    state: CityState
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    broadcaster: Broadcaster = field(
        default_factory=lambda: Broadcaster(start_id=int(time.time() * 1000))
    )
    sim_task: asyncio.Task | None = None


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
        for runtime in self._runtimes.values():
            if runtime.sim_task is not None and not runtime.sim_task.done():
                runtime.sim_task.cancel()
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
            # 进程重启后内存里的 sim_task 会丢：只要城市还在建设期且没暂停，
            # 就把实时循环接回来，否则前端会看到「时间停了」。
            if state.phase is Phase.BUILDING and not state.clock.paused:
                runtime.sim_task = asyncio.create_task(self._simulation_loop(runtime))
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
            districts=[d.to_dict() for d in state.districts.districts.values()],
            transit=[line.to_dict() for line in state.transit.lines.values()],
        )

    # ---- 实时模拟（C:S 的连续推进 + 速度档）----

    SIM_TICK_SEC = 1.0 / 12.0  # 1x 速度下每帧的现实秒数（一年 3600 帧 ≈ 300 秒）
    SIM_PUBLISH_EVERY = 8      # 每 8 tick 推一次快照，约 1.5 次/秒

    async def set_speed(self, city_code: str, speed: int) -> dict[str, Any]:
        """设置模拟速度档：0 暂停 / 1 1x / 2 2x / 3 3x（实际 4x）。"""
        if speed not in (0, 1, 2, 3):
            raise GameError(
                ErrorCode.INVALID_PLACEMENT, "速度档位无效", {"speed": speed}
            )
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            runtime.state.clock.speed = speed
            if speed > 0 and (runtime.sim_task is None or runtime.sim_task.done()):
                runtime.sim_task = asyncio.create_task(self._simulation_loop(runtime))
            view = self._sim_view(runtime.state)
        runtime.broadcaster.publish("speed_change", view)
        return view

    async def set_tax_rate(self, city_code: str, service: str, rate: int) -> dict[str, Any]:
        """设置某服务类别的税率（C:S 的 1..29 百分点）。"""
        from app.sim.budget import Service

        try:
            svc = Service(service)
        except ValueError as exc:
            raise GameError(
                ErrorCode.INVALID_PLACEMENT, "未知的服务类别", {"service": service}
            ) from exc
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            applied = runtime.state.budget.set_tax_rate(svc, rate)
            runtime.state._recompute()
            view = self._sim_view(runtime.state)
            view["tax_rates"] = dict(runtime.state.budget.tax_rates)
        runtime.broadcaster.publish("tax_change", view)
        return {"service": svc.value, "rate": applied, "view": view}

    async def take_loan(
        self, city_code: str, amount: int, months: int = 60, rate_bp: int = 500
    ) -> dict[str, Any]:
        """申请一笔贷款：资金立即到账，按月摊销本息（C:S 的 Loan 结构）。"""
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            loan = runtime.state.budget.take_loan(amount, rate_bp, months)
            runtime.state.funds += amount
            runtime.state.metrics = runtime.state.metrics.model_copy(
                update={"funds": runtime.state.funds}
            )
            view = self._sim_view(runtime.state)
        runtime.broadcaster.publish("budget_change", view)
        return {
            "principal": loan.principal,
            "remaining": loan.remaining,
            "monthly_payment": loan.monthly_payment(),
            "months": loan.months,
            "rate_bp": loan.rate_bp,
            "view": view,
        }

    async def _simulation_loop(self, runtime: SaveRuntime) -> None:
        """每 SIM_TICK_SEC 推进一个 tick；暂停时挂起但不退出。"""
        ticks = 0
        try:
            # 先推一次完整视图：前端订阅后即使处于暂停，也能立刻拿到财政/市民/天气
            runtime.broadcaster.publish("sim_tick", self._sim_view(runtime.state))
            while True:
                await asyncio.sleep(self.SIM_TICK_SEC)
                async with runtime.lock:
                    state = runtime.state
                    if state.closed or state.finalized:
                        return
                    if state.clock.paused or state.phase is not Phase.BUILDING:
                        # 暂停时帧不动，但面板数据要能刷新（税率、贷款、市民结构）
                        ticks += 1
                        if ticks % (self.SIM_PUBLISH_EVERY * 4) == 0:
                            runtime.broadcaster.publish("sim_tick", self._sim_view(state))
                        continue
                    state.advance(1)
                    ticks += 1
                    if ticks % self.SIM_PUBLISH_EVERY == 0:
                        runtime.broadcaster.publish("sim_tick", self._sim_view(state))
        except asyncio.CancelledError:
            raise
        except Exception:  # 实时循环异常不应拖垮服务
            log.exception("simulation loop failed for %s", runtime.state.city_code)

    @staticmethod
    def _sim_view(state: CityState) -> dict[str, Any]:
        return {
            "frame": state.clock.frame,
            "year": state.at_year,
            "speed": state.clock.speed,
            "paused": state.clock.paused,
            "hour": round(state.clock.hour, 2),
            "demand": {
                "residential": Demand.to_ui(state.demand.displayed_residential),
                "commercial": Demand.to_ui(state.demand.displayed_commercial),
                "workplace": Demand.to_ui(state.demand.displayed_workplace),
            },
            "builds_total": state.builds_total,
            "budget": {
                "funds": state.funds,
                "day_income": sum(state.budget.day_income.values()),
                "day_expenses": sum(state.budget.day_expenses.values()),
                "night_expenses": state.budget.night_expenses,
                "debt": state.budget.total_debt(),
                "tax_rates": dict(state.budget.tax_rates),
                "income_by_service": dict(state.budget.day_income),
                "expenses_by_service": dict(state.budget.day_expenses),
            },
            "citizens": state.citizens.stats().to_dict(),
            "districts": [d.to_dict() for d in state.districts.districts.values()],
            "transit": [line.to_dict() for line in state.transit.lines.values()],
            "weather": state.weather.to_dict() if state.weather else None,
            "history": state.history[-40:],
            "milestone": milestone_view(state.metrics.population),
            "policies": policy_list(state.city_policies),
            "disaster": state.last_disaster,
            "transit_coverage": round(
                state.transit.coverage_ratio(
                    [t.id for t in state.tiles.values() if t.type in _RES_TYPES],
                    [t.id for t in state.tiles.values() if t.type in _JOB_TYPES],
                ),
                4,
            ),
            "metrics": state.metrics.model_dump(mode="json") if state.metrics else None,
        }

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
        if op_type == "zone":
            # 批量划区：C:S 的刷子。逐格放置的确定性由 anchor 顺序 + 固定 tile_id 保证。
            state.zone(
                TileType(payload["type"]),
                payload["anchor"],
                int(payload["rows"]),
                int(payload["cols"]),
            )
            return None, [], None
        if op_type == "rename":
            tile = state.rename_tile(payload["tile_id"], payload.get("name"))
            if tile is None:
                raise GameError(ErrorCode.INVALID_PAYLOAD, "地块不存在", {"tile_id": payload["tile_id"]})
            return None, tile, None
        if op_type == "historical":
            tile = state.set_historical(payload["tile_id"], bool(payload.get("historical", True)))
            if tile is None:
                raise GameError(ErrorCode.INVALID_PAYLOAD, "地块不存在", {"tile_id": payload["tile_id"]})
            return None, tile, None
        if op_type == "relocate":
            moved, reason = state.relocate_tile(payload["tile_id"], list(payload["anchor"]))
            if moved is None:
                raise GameError(ErrorCode.INVALID_PLACEMENT, reason or "无法搬迁",
                                {"tile_id": payload["tile_id"]})
            return moved, [], None
        if op_type == "city_policy":
            policy = str(payload["policy"])
            if policy not in CITY_POLICIES:
                raise GameError(ErrorCode.INVALID_PAYLOAD, "未知政策", {"policy": policy})
            state.set_city_policy(policy, bool(payload.get("enabled", True)))
            return None, [], None

        if op_type == "district":
            state.create_district(
                payload.get("name", ""),
                payload["anchor"],
                int(payload.get("rows", 1)),
                int(payload.get("cols", 1)),
            )
            return None, [], None
        if op_type == "district_policy":
            state.set_district_policy(
                int(payload["did"]), str(payload["policy"]), bool(payload["enabled"])
            )
            return None, [], None
        if op_type == "transit_line":
            lid, reason = state.create_transit_line(
                str(payload.get("name", "")),
                str(payload["kind"]),
                list(payload.get("stops", [])),
                str(payload.get("color", "#3D8BFF")),
            )
            if reason is not None:
                raise GameError(
                    ErrorCode.INVALID_PAYLOAD if reason != "INSUFFICIENT_FUNDS" else ErrorCode.CONFLICT,
                    f"建线失败: {reason}",
                    {"reason": reason},
                )
            return None, [], None
        if op_type == "transit_stop":
            reason = state.add_transit_stop(
                int(payload["lid"]), str(payload["tile_id"]), payload.get("index")
            )
            if reason is not None:
                raise GameError(ErrorCode.INVALID_PAYLOAD, f"加站失败: {reason}", {"reason": reason})
            return None, [], None
        if op_type == "transit_price":
            reason = state.set_transit_price(int(payload["lid"]), float(payload["price"]))
            if reason is not None:
                raise GameError(ErrorCode.NOT_FOUND, "线路不存在", {"lid": payload["lid"]})
            return None, [], None
        if op_type == "transit_delete":
            reason = state.delete_transit_line(int(payload["lid"]))
            if reason is not None:
                raise GameError(ErrorCode.NOT_FOUND, "线路不存在", {"lid": payload["lid"]})
            return None, [], None
        if op_type == "advance":
            return None, state.advance_year(), None
        if op_type == "redevelop":
            return None, [], state.redevelop(payload["anchor"])
        raise RuntimeError(f"未知 op_type: {op_type}")

    async def zone(
        self,
        city_code: str,
        *,
        tile_type: str,
        anchor: list[int],
        rows: int,
        cols: int,
        client_op_id: str,
    ) -> OperationResult:
        """批量划区：一次铺 rows×cols 片，等价于 C:S 的拖拽刷子。"""
        payload = {
            "type": tile_type,
            "anchor": anchor,
            "rows": max(1, min(rows, 16)),
            "cols": max(1, min(cols, 16)),
        }
        return await self.apply(city_code, "zone", client_op_id=client_op_id, payload=payload)

    async def rename_tile(
        self, city_code: str, *, tile_id: str, name: str | None, client_op_id: str
    ) -> OperationResult:
        return await self.apply(
            city_code,
            "rename",
            client_op_id=client_op_id,
            payload={"tile_id": tile_id, "name": name},
        )

    async def set_historical(
        self, city_code: str, *, tile_id: str, historical: bool, client_op_id: str
    ) -> OperationResult:
        return await self.apply(
            city_code,
            "historical",
            client_op_id=client_op_id,
            payload={"tile_id": tile_id, "historical": historical},
        )

    async def relocate_tile(
        self, city_code: str, *, tile_id: str, anchor: list[int], client_op_id: str
    ) -> OperationResult:
        return await self.apply(
            city_code,
            "relocate",
            client_op_id=client_op_id,
            payload={"tile_id": tile_id, "anchor": anchor},
        )

    async def set_city_policy(
        self, city_code: str, *, policy: str, enabled: bool, client_op_id: str
    ) -> OperationResult:
        return await self.apply(
            city_code, "city_policy",
            client_op_id=client_op_id,
            payload={"policy": policy, "enabled": enabled},
        )

    async def create_district(
        self,
        city_code: str,
        *,
        name: str,
        anchor: list[int],
        rows: int,
        cols: int,
        client_op_id: str,
    ) -> OperationResult:
        """圈一个行政区：C:S 的 DistrictTool 刷子，这里用矩形近似。"""
        payload = {
            "name": name,
            "anchor": anchor,
            "rows": max(1, min(rows, 16)),
            "cols": max(1, min(cols, 16)),
        }
        return await self.apply(
            city_code, "district", client_op_id=client_op_id, payload=payload
        )

    async def set_district_policy(
        self,
        city_code: str,
        *,
        did: int,
        policy: str,
        enabled: bool,
        client_op_id: str,
    ) -> dict[str, Any]:
        """开关一条区政策（C:S 的 SetDistrictPolicy / UnsetDistrictPolicy）。"""
        if policy not in POLICIES:
            raise GameError(ErrorCode.INVALID_PAYLOAD, "未知政策", {"policy": policy})
        result = await self.apply(
            city_code,
            "district_policy",
            client_op_id=client_op_id,
            payload={"did": did, "policy": policy, "enabled": enabled},
        )
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            district = runtime.state.districts.districts.get(did)
            if district is None:
                raise GameError(ErrorCode.NOT_FOUND, "行政区不存在", {"did": did})
            view = self._sim_view(runtime.state)
            runtime.broadcaster.publish("district_change", view)
        return {"district": district.to_dict(), "view": view, "op": result}


    async def create_transit_line(
        self,
        city_code: str,
        *,
        name: str,
        kind: str,
        stops: list[str],
        color: str = "#3D8BFF",
        client_op_id: str,
    ) -> dict[str, Any]:
        """建一条公交/地铁线（C:S 的 TransportLine）。"""
        if kind not in LINE_KINDS:
            raise GameError(ErrorCode.INVALID_PAYLOAD, "未知制式", {"kind": kind})
        await self.apply(
            city_code,
            "transit_line",
            client_op_id=client_op_id,
            payload={"name": name, "kind": kind, "stops": stops, "color": color},
        )
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            lines = list(runtime.state.transit.lines.values())
            if not lines:
                raise GameError(ErrorCode.CONFLICT, "线路未创建", {})
            line = lines[-1]
            return {"line": line.to_dict(), "view": self._sim_view(runtime.state)}

    async def add_transit_stop(
        self, city_code: str, *, lid: int, tile_id: str, index: int | None = None,
        client_op_id: str,
    ) -> dict[str, Any]:
        await self.apply(
            city_code, "transit_stop", client_op_id=client_op_id,
            payload={"lid": lid, "tile_id": tile_id, "index": index},
        )
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            return {"line": runtime.state.transit.lines[lid].to_dict(),
                    "view": self._sim_view(runtime.state)}

    async def set_transit_price(
        self, city_code: str, *, lid: int, price: float, client_op_id: str
    ) -> dict[str, Any]:
        await self.apply(
            city_code, "transit_price", client_op_id=client_op_id,
            payload={"lid": lid, "price": price},
        )
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            return {"line": runtime.state.transit.lines[lid].to_dict(),
                    "view": self._sim_view(runtime.state)}

    async def delete_transit_line(
        self, city_code: str, *, lid: int, client_op_id: str
    ) -> dict[str, Any]:
        await self.apply(
            city_code, "transit_delete", client_op_id=client_op_id, payload={"lid": lid}
        )
        runtime = await self._runtime(city_code)
        async with runtime.lock:
            return {"deleted": lid, "view": self._sim_view(runtime.state)}

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
                tile=tile if op_type in ("place", "remove", "relocate", "historical", "rename") else None,
                tiles=list(working.tiles.values()),
                redeveloped_asset_ids=sorted(working.redeveloped_asset_ids),
                redevelopment=redevelopment,
                metrics=working.metrics,
                metrics_diff=diff,
                funds_after=working.funds,
                city_year=working.at_year,
                annual_events=annual_events if isinstance(annual_events, list) else [],
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
