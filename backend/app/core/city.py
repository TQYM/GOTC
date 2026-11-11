"""不限时城市领域状态：完整快照、实际入住与共享年度步进。

时间推进复刻 C:S：内部以 frame 为唯一时间单位（`sim/clock.py`），
年度步进只是「跑满一年帧数」的快捷方式；需求走 `sim/demand.py` 的双轨值，
建造走 `sim/gate.py` 的全局闸门。
"""

import random
from dataclasses import dataclass, field
from typing import Any

from app.config import SimConfig
from app.contracts.asset import ExistingAsset
from app.contracts.errors import ErrorCode
from app.contracts.finalize import ProjectionYear
from app.contracts.metrics import Metrics, Phase
from app.contracts.parcel import Parcel, Terrain
from app.contracts.save import RedevelopmentResult
from app.contracts.tile import Tile, TileType
from app.core.errors import GameError
from app.core.session import GameSession
from app.sim import engine
from app.sim.budget import CityBudget, Service
from app.sim.catalog import CATALOG, expand_cells, placement_cost
from app.sim.citizens import CitizenPool
from app.sim.disasters import DisasterResult, roll_disaster
from app.sim.weather import WeatherState, weather_at
from app.sim.districts import DistrictManager
from app.sim.policies import policy_effects
from app.sim.transit import LINE_KINDS, TransitManager
from app.sim.clock import SimulationClock
from app.sim.demand import Demand
from app.sim.events import EVENT_LABELS, modifier_for, roll_event
from app.sim.gate import BuildGate
from app.sim.population import ResStat, residential_stats
from app.sim.projection import _year_events

_BUILDABLE_TERRAIN = {Terrain.FLAT, Terrain.HILL, Terrain.FOREST}

MIGRATION_LIMIT = 0.08
# 闸门放行一栋时，occupancy 一次增加容量的 2%（一栋楼的量级）
BUILD_PER_FRAME = 0.05
EXODUS_THRESHOLD = 40
EXODUS_PENALTY = 0.05
RELOCATION_HAPPINESS_DELTA = -5
RELOCATION_PENALTY_YEARS = 3


def _weather_from_snapshot(data: dict | None) -> WeatherState | None:
    """快照 → 天气对象；缺失时返回 None（旧存档继续用晴天乘数）。"""
    if not data:
        return None
    return WeatherState(
        season=str(data.get("season", "spring")),
        kind=str(data.get("kind", "clear")),
        temperature=int(data.get("temperature", 20)),
        cloud=float(data.get("cloud", 0.0)),
        rain=float(data.get("rain", 0.0)),
        fog=float(data.get("fog", 0.0)),
    )


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
    # ---- C:S 结构复刻：帧时钟 / 需求双轨 / 建造闸门 ----
    clock: SimulationClock = field(default_factory=SimulationClock)
    demand: Demand = field(default_factory=Demand)
    gate: BuildGate = field(default_factory=BuildGate)
    builds_total: int = 0
    builds_by_type: dict[str, int] = field(default_factory=dict)
    # tile_id -> 建成度 0..1（C:S 的「划区 ≠ 建成」；缺省视为 1.0 兼容旧存档）
    built: dict[str, float] = field(default_factory=dict)
    # ---- C:S 经济结构：16 段日分片账本 / 税率 / 贷款 ----
    budget: CityBudget = field(default_factory=CityBudget)
    citizens: CitizenPool = field(default_factory=CitizenPool)
    districts: DistrictManager = field(default_factory=DistrictManager)
    transit: TransitManager = field(default_factory=TransitManager)
    # 上一年发生的灾难（C:S 的 DisasterManager 事件；None 表示平安）
    last_disaster: dict | None = None
    _disaster_penalty: int = field(default=0, repr=False)
    # 城市级政策（C:S 的 Policies 面板；区政策在 districts.py）
    city_policies: set[str] = field(default_factory=set)
    # 逐年指标快照（C:S 的 StatisticsManager：玩家能回看城市怎么长大的）
    history: list[dict] = field(default_factory=list)
    # 当天天气（C:S 的 WeatherManager；按游戏日离散生成）
    weather: WeatherState | None = None
    # 预算累加用「千分之一元」整数，避免浮点在长重放中累积误差（见 _accrue_budget）
    _income_milli: int = field(default=0, repr=False)
    _expense_milli: int = field(default=0, repr=False)
    _targets: list[ResStat] = field(default_factory=list, repr=False)
    _base_targets: list[ResStat] = field(default_factory=list, repr=False)
    _targets_dirty: bool = field(default=True, repr=False)

    def __post_init__(self) -> None:
        # 不调用旧 __post_init__：资金为 0 是合法破产状态，不能被重置为初始资金。
        self.occupied = {}
        for tile in self.tiles.values():
            for row, col in tile.cells:
                self.occupied[(row, col)] = tile.id
        if not self.citizens.agents:
            self.citizens.set_seed(self.parcel.seed)
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
        effects = self.districts.effects(
            {tile.id: tile.type.value for tile in self.tiles.values()}
        )
        adjustment += int(effects["happiness"])
        # 灾难冲击计入当年的指标重算：必须是可持久化的派生量，
        # 否则恢复端 `_recompute` 会把它抹掉（曾导致 happiness 差 8）。
        adjustment += self._disaster_penalty
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
            built=self.built,
            tax_rate=float(self.budget.tax_rates[Service.RESIDENTIAL]) + effects["tax_delta"],
            pollution_scale=1.0 + effects["pollution_delta"],
            transit=self.transit,
            weather=self.weather,
            policies=policy_effects(self.city_policies),
        )
        self._sync_citizens()

    def _stats_with_actual_occupancy(self) -> list[ResStat]:
        """住宅统计：地块几何只在放置/移除后重扫，其余调用复用缓存。

        帧制下 `_recompute` 每 256 帧一次（200 游戏年 = 2800 次），若每次都
        重扫 48×48 地块，持久化测试会被拖到分钟级。几何是静态的，只有
        occupancy 每帧在变，因此把两者拆开。
        """
        if self._targets_dirty or not self._base_targets:
            self._base_targets = residential_stats(
                self.parcel, list(self.tiles.values()), self.config
            )
            self._targets_dirty = False
            target_ids = {stat.tile_id for stat in self._base_targets}
            self.occupancy = {
                tile_id: value
                for tile_id, value in self.occupancy.items()
                if tile_id in target_ids
            }
        # 注意：`_targets` 必须指向**带最新 occupancy** 的那份列表。
        # 早期实现把 `_targets` 设成几何缓存（occupancy 停在首次构建时的 0），
        # 只把新列表 return 出去 —— 于是 `_try_build` / `_migrate_step` 读到的
        # 永远是旧入住数，刚落成的容量下一帧又被当成空置。
        self._targets = [
            ResStat(
                stat.tile_id,
                stat.anchor,
                stat.capacity,
                stat.attraction,
                self.occupancy.get(stat.tile_id, 0.0),
            )
            for stat in self._base_targets
        ]
        return self._targets

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
        """推进一整年。内部按帧跑（C:S 结构），年度结算在跨年时触发。"""
        self._check_building()
        return self._run_frames(self.clock.frames_per_year)

    def advance(self, frames: int) -> list[str]:
        """推进任意帧数；速度控制与测试走这里。"""
        self._check_building()
        if frames <= 0:
            return []
        return self._run_frames(frames)

    def _run_frames(self, frames: int) -> list[str]:
        labels: list[str] = []
        for _ in range(frames):
            for sub_step in self.clock.advance():
                labels.extend(self._simulation_step(sub_step))
        return labels

    def _simulation_step(self, sub_step: int) -> list[str]:
        """单个 subStep。0 = 暂停（只跑脏队列），>=1 = 正常推进。"""
        if sub_step == 0:
            return []
        frame = self.clock.frame
        if frame % 16 == 0:
            self._refresh_demand()
        self.demand.smooth()
        self._migrate_step()
        self._refresh_weather()
        self._accrue_budget(frame)
        if self.gate.can_build(frame):
            self._try_build(frame)
        self._try_upgrade(frame)
        if frame and frame % 256 == 0:
            self._recompute()
            self._settle_day(frame)
        if self.clock.year > self.at_year:
            return self._settle_year()
        return []

    def _sync_citizens(self) -> None:
        """把聚合人口灌进代理池。

        这里刻意**不做**「人口变化小于 1% 就跳过」的优化：那会让代理数量
        依赖 `_recompute` 的调用路径（全量重放 vs 快照恢复），最终快照对不上。
        改成每次都以 population 为准，`CitizenPool.sync` 内部只在数量变化时
        才增删代理 —— 同样的 population 必然得到同样的 agent 列表。
        """
        population = int(self.metrics.population)
        homes = [target.tile_id for target in self._targets]
        job_types = {
            TileType.COM_SHOP,
            TileType.COM_CBD,
            TileType.IND_LIGHT,
            TileType.IND_HEAVY,
        }
        jobs = [tile.id for tile in self.tiles.values() if tile.type in job_types]
        self.citizens.sync(population, homes, jobs)

    def _existing_population(self) -> int:
        """未被拆除的既有建筑里住着的人。

        真实片区的「现状人口」必须同时进需求公式的两边：只加人口不加住房，
        空城就会一直显示 100% 住宅需求（空置率被除零保护兜成 1.0）。
        """
        return sum(
            asset.population
            for asset_id, asset in self.existing_assets.items()
            if asset_id not in self.redeveloped_asset_ids
        )

    def _refresh_demand(self) -> None:
        """按供需缺口重算需求真值（C:S 的 m_actual*）。"""
        existing = self._existing_population()
        population = int(sum(self.occupancy.values())) + existing
        housing_capacity = int(sum(target.capacity for target in self._targets)) + existing
        jobs = self.metrics.jobs if self.metrics else 0
        # 商业/办公容量按「已建成地块」统计，不能用 jobs 反推 —— 那会死锁：
        # jobs 依赖商业建成，商业需求又依赖 jobs。
        emp = self.config.employment
        com_capacity = 0.0
        office_capacity = 0
        for tile in self.tiles.values():
            ratio = self.built.get(tile.id, 1.0)
            if tile.type is TileType.COM_SHOP:
                com_capacity += emp.jobs_shop * ratio
            elif tile.type is TileType.COM_CBD:
                com_capacity += emp.jobs_cbd * ratio
                office_capacity += int(emp.jobs_cbd * ratio)
        workforce = int(population * 0.55)
        self.demand.recompute(
            population=population,
            housing_capacity=housing_capacity,
            jobs=jobs,
            workforce=workforce,
            commercial_capacity=int(com_capacity),
            office_capacity=office_capacity,
        )

    def _migrate_step(self) -> None:
        """幸福度连续两年低于阈值时逐帧迁出（原按年惩罚的帧化版本）。

        正常年份不做「小步迁移」——入住由 `_try_build` 的落成事件驱动，
        否则每帧的阻尼会把刚落成的容量又压回去（旧实现即因此长不出人口）。
        """
        if self.low_happiness_streak < 2 or not self._targets:
            return
        per_frame = EXODUS_PENALTY / self.clock.frames_per_year
        for target in self._targets:
            current = self.occupancy.get(target.tile_id, 0.0)
            self.occupancy[target.tile_id] = max(
                0.0, current - target.capacity * per_frame
            )

    def _try_build(self, frame: int) -> None:
        """闸门已开：随机挑一块「未建成的地块」，再按该类的需求概率决定建不建。

        这与 C:S 的语义一致——建在哪由区划位置决定，建不建由需求决定；
        顺序 return 会让高需求类别吃光所有机会（商业恒 +1.0 时工业永远拿不到）。
        """
        rng = random.Random(self.parcel.seed * 1_000_003 ^ frame)

        sites: list[tuple[str, str, ResStat | Tile]] = []
        for target in self._targets:
            if self.occupancy.get(target.tile_id, 0.0) < target.capacity - 1e-6:
                sites.append(("residential", target.tile_id, target))
        blocked = self.districts.effects(
            {tile.id: tile.type.value for tile in self.tiles.values()}
        )["blocked_types"]
        for tile in self.tiles.values():
            if self.built.get(tile.id, 1.0) >= 1.0 - 1e-6:
                continue
            if tile.type.value in blocked:
                continue
            if tile.type in (TileType.COM_SHOP, TileType.COM_CBD):
                sites.append(("commercial", tile.id, tile))
            elif tile.type in (TileType.IND_LIGHT, TileType.IND_HEAVY):
                sites.append(("workplace", tile.id, tile))
        if not sites:
            return

        kind, tile_id, obj = sites[rng.randrange(len(sites))]
        demand = getattr(self.demand, f"actual_{kind}")
        if demand <= 0 or rng.random() >= demand:
            return

        if kind == "residential" and isinstance(obj, ResStat):
            current = self.occupancy.get(tile_id, 0.0)
            self.occupancy[tile_id] = min(
                obj.capacity, current + obj.capacity * BUILD_PER_FRAME
            )
        self.built[tile_id] = min(1.0, self.built.get(tile_id, 1.0) + BUILD_PER_FRAME)
        self._count_build(kind)

    # ---- 放置/移除：维护「建成度」（C:S 的划区 ≠ 建成）----
    def place(self, *args: Any, **kwargs: Any):
        tile, _metrics, diff, _funds = super().place(*args, **kwargs)
        self.built[tile.id] = 0.0
        self._targets_dirty = True
        self._recompute()
        return tile, self.metrics, diff, self.funds

    def zone(
        self,
        tile_type: Any,
        anchor: list[int],
        rows: int,
        cols: int,
    ) -> tuple[list[str], list[dict], Metrics]:
        """批量划区：对齐 C:S 的拖拽刷子（一次铺一片，而不是一栋一栋点）。

        逐格尝试放置，失败（越界/占用/资金不足）只记录不中断；结束后统一
        重算一次指标。返回（成功 tile_id 列表, 跳过原因列表, 最新指标）。
        """
        placed: list[str] = []
        skipped: list[dict] = []
        base_r, base_c = anchor
        for dr in range(max(1, rows)):
            for dc in range(max(1, cols)):
                spot = [base_r + dr, base_c + dc]
                try:
                    tile, _metrics, _diff, _funds = super().place(tile_type, spot)
                except Exception as exc:  # noqa: BLE001 - 逐格容错是刷子的语义
                    skipped.append({"anchor": spot, "reason": getattr(exc, "code", str(exc))})
                    continue
                self.built[tile.id] = 0.0
                placed.append(tile.id)
        self._targets_dirty = True
        self._recompute()
        return placed, skipped, self.metrics

    def create_district(
        self,
        name: str,
        anchor: list[int],
        rows: int,
        cols: int,
    ) -> Any:
        """按矩形圈一个行政区（C:S 的刷子近似）。

        只收已存在的地块，不新建；圈中空地等以后建成再归区。
        """
        base_r, base_c = anchor
        tiles = [
            tile.id
            for tile in self.tiles.values()
            if base_r <= tile.anchor[0] < base_r + max(1, rows)
            and base_c <= tile.anchor[1] < base_c + max(1, cols)
        ]
        district = self.districts.create(name, tiles)
        self._recompute()
        return district

    def rename_tile(self, tile_id: str, name: str | None) -> Tile | None:
        tile = self.tiles.get(tile_id)
        if tile is None:
            return None
        cleaned = (name or "").strip()[:32] or None
        self.tiles[tile_id] = tile.model_copy(update={"name": cleaned})
        return self.tiles[tile_id]

    def relocate_tile(self, tile_id: str, anchor: list[int]) -> tuple[Tile | None, str | None]:
        """搬迁一栋建筑（C:S 的 RelocateBuilding）。

        与「拆了重建」的区别：建成度、历史标志、自定义名称全部保留，
        只换占格；费用按原造价的 30% 收。跨河桥不支持搬迁。
        """
        tile = self.tiles.get(tile_id)
        if tile is None:
            return None, "地块不存在"
        if tile.type is TileType.UTIL_BRIDGE:
            return None, "跨河桥不支持搬迁"
        try:
            cells = expand_cells(tile.type, anchor)
        except ValueError as exc:
            return None, str(exc)
        for r, c in cells:
            if not (0 <= r < len(self.parcel.terrain) and 0 <= c < len(self.parcel.terrain[r])):
                return None, "目标越界"
            terrain = self._terrain_at(r, c)
            if terrain not in _BUILDABLE_TERRAIN:
                return None, f"目标格不可建设（terrain={terrain.value}）"
        old_cells = {tuple(cell) for cell in tile.cells}
        for r, c in cells:
            occupant = self.occupied.get((r, c))
            if occupant is not None and occupant != tile_id:
                return None, "目标格已被占用"
        cost = placement_cost(tile.type, cells, self.parcel.terrain)
        fee = max(1_000, int(cost * 0.3))
        if fee > self.funds:
            return None, f"资金不足（需 {fee}）"
        for r, c in old_cells:
            self.occupied.pop((r, c), None)
        for r, c in cells:
            self.occupied[(r, c)] = tile_id
        moved = tile.model_copy(update={"anchor": list(anchor), "cells": [list(c) for c in cells]})
        self.tiles[tile_id] = moved
        self.funds -= fee
        self._targets_dirty = True
        self._recompute()
        return moved, None

    def set_historical(self, tile_id: str, historical: bool = True) -> Tile | None:
        """标记/取消历史建筑：只影响升级，不阻止玩家手动拆除（对齐 C:S）。"""
        tile = self.tiles.get(tile_id)
        if tile is None:
            return None
        self.tiles[tile_id] = tile.model_copy(update={"historical": historical})
        return self.tiles[tile_id]

    def set_district_policy(self, did: int, policy: str, enabled: bool) -> bool:
        changed = self.districts.set_policy(did, policy, enabled)
        if changed:
            self._recompute()
        return changed


    # ---- 公共交通线路（对齐 C:S TransportManager）----
    def create_transit_line(
        self, name: str, kind: str, stops: list[str], color: str = "#3D8BFF"
    ) -> tuple[int | None, str | None]:
        """建线：站点必须是已存在的 `trans_metro` 地块，且至少两站。"""
        if kind not in LINE_KINDS:
            return None, "UNKNOWN_KIND"
        valid: list[str] = []
        for tile_id in stops:
            tile = self.tiles.get(tile_id)
            if tile is None or tile.type is not TileType.TRANS_METRO:
                continue
            if tile_id not in valid:
                valid.append(tile_id)
        if len(valid) < 2:
            return None, "NOT_ENOUGH_STOPS"
        cost = int(LINE_KINDS[kind]["cost"])
        if self.funds < cost:
            return None, "INSUFFICIENT_FUNDS"
        self.funds -= cost
        line = self.transit.create_line(name, kind, valid, color)
        if line is None:
            self.funds += cost
            return None, "LINE_LIMIT"
        self._recompute()
        return line.lid, None

    def add_transit_stop(self, lid: int, tile_id: str, index: int | None = None) -> str | None:
        tile = self.tiles.get(tile_id)
        if tile is None or tile.type is not TileType.TRANS_METRO:
            return "NOT_A_STOP"
        if not self.transit.add_stop(lid, tile_id, index):
            return "REJECTED"
        self._recompute()
        return None

    def remove_transit_stop(self, lid: int, tile_id: str) -> str | None:
        if not self.transit.remove_stop(lid, tile_id):
            return "REJECTED"
        self._recompute()
        return None

    def delete_transit_line(self, lid: int) -> str | None:
        line = self.transit.lines.get(lid)
        if line is None:
            return "NOT_FOUND"
        self.funds += int(int(LINE_KINDS[line.kind]["cost"]) * 0.3)  # 拆除返还 30%
        self.transit.delete_line(lid)
        self._recompute()
        return None

    def set_transit_price(self, lid: int, price: float) -> str | None:
        if not self.transit.set_price(lid, price):
            return "NOT_FOUND"
        return None

    def remove(self, tile_id: str):
        tile, _metrics, diff, _funds = super().remove(tile_id)
        self.built.pop(tile_id, None)
        self._targets_dirty = True
        self._recompute()
        return tile, self.metrics, diff, self.funds

    def _try_upgrade(self, frame: int) -> None:
        """建筑等级升级：低层 → 多层 → 高层（C:S 的 level up）。

        只有「已建成 + 地价够高」的住宅会升级；地价越高概率越大。
        升级后容量变大，入住率自然回落，需要新的居民填满——这与 C:S 里
        地价推着老楼翻新、人口继续涌入的节奏一致。
        """
        if frame % 1024 != 0 or not self.tiles:
            return
        price = self.metrics.land_price_index
        if price < 55:
            return
        chance = (price - 50) / 200  # 地价 55 → 2.5%，100 → 25%
        rng = random.Random(self.parcel.seed * 7_777_777 ^ frame)
        next_type = {
            TileType.RES_LOW: TileType.RES_MID,
            TileType.RES_MID: TileType.RES_HIGH,
        }
        upgraded = 0
        for tile in list(self.tiles.values()):
            target = next_type.get(tile.type)
            if tile.historical:
                continue
            if target is None or self.built.get(tile.id, 0.0) < 1.0 - 1e-6:
                continue
            if rng.random() > chance:
                continue
            tile.type = target
            tile.upkeep = CATALOG[target].upkeep
            self._targets_dirty = True
            upgraded += 1
            if upgraded >= 3:
                break
        if upgraded:
            self._recompute()

    def _count_build(self, kind: str) -> None:
        self.builds_by_type[kind] = self.builds_by_type.get(kind, 0) + 1
        self.builds_total += 1

    def _accrue_budget(self, frame: int) -> None:
        """把年度收支摊到每一帧，按 16 段日分片入账（C:S `m_income[]/m_expenses[]`）。

        用浮点累加器保留小数，只有攒够 1 元才落账，避免每帧 round 丢精度。
        """
        metrics = self.metrics
        if metrics is None:
            return
        # 整数毫单位：tax_income / frames_per_year 的余数留在 milli 里，永不丢精度。
        # 用浮点会让「全量重放」与「快照+增量」的低位误差在 200 年后差出 1 元。
        self._income_milli += metrics.tax_income * 1000 // self.clock.frames_per_year
        income = self._income_milli // 1000
        if income:
            self._income_milli -= income * 1000
            self.budget.add_income(Service.RESIDENTIAL, income, frame)
        self._expense_milli += metrics.upkeep * 1000 // self.clock.frames_per_year
        expense = self._expense_milli // 1000
        if expense:
            self._expense_milli -= expense * 1000
            self.budget.add_expense(
                Service.UTILITY, expense, frame, night=self.clock.is_night
            )

    def _refresh_weather(self) -> None:
        """按游戏日刷新天气；同一天内保持稳定（C:S 也是按天气周期推进）。"""
        days = max(1, self.clock.frames_per_year // self.clock.frames_per_day)
        day_of_year = (self.clock.frame // self.clock.frames_per_day) % days + 1
        if self.weather is not None and getattr(self.weather, "_day", None) == day_of_year:
            return
        self.weather = weather_at(self.parcel.seed, day_of_year, days)
        # 记录生成日期，避免同一天重复计算（dataclass 是 frozen，用 object.__setattr__）
        object.__setattr__(self.weather, "_day", day_of_year)

    def _settle_day(self, frame: int) -> None:
        """每 256 帧结算一次：汇总 16 段、还贷款、资金按日流动（C:S 也是按日结算）。"""
        settlement = self.budget.settle_day(frame, self.funds)
        self.funds += settlement.net
        self.metrics = self.metrics.model_copy(update={"funds": self.funds})
        if self.funds < 0 and self.metrics.tax_income < self.metrics.upkeep * 0.8:
            self.bankrupt = True

    def _settle_year(self) -> list[str]:
        """跨年结算：事件、财政、破产与标签（原 advance_year 的后半段）。"""
        before = self.metrics
        self.at_year = self.clock.year
        self.years_settled += 1
        self.current_event = roll_event(self.parcel.seed, self.at_year, self.cleared_forest)
        self._recompute()
        # 资金已按 256 帧一次的日结算流动（C:S 结构）；跨年这里只做统计与事件，
        # 不再重复加一遍年度收支。
        self.metrics = self.metrics.model_copy(update={"funds": self.funds})

        self.citizens.advance_year(
            year=self.at_year,
            school_coverage=self.metrics.coverage_edu,
            clinic_coverage=self.metrics.coverage_med,
            pollution=self.metrics.pollution * 100.0,
            avg_commute=self.metrics.avg_commute,
            job_openings=self.metrics.jobs,
        )

        # 灾难判定（消防/排水覆盖越低越容易发生）
        self._disaster_penalty = 0
        self.last_disaster = None
        candidates = [
            tile.id
            for tile in self.tiles.values()
            if self.built.get(tile.id, 0.0) >= 1.0 - 1e-6
            and tile.type
            in (
                TileType.RES_LOW,
                TileType.RES_MID,
                TileType.RES_HIGH,
                TileType.COM_SHOP,
                TileType.COM_CBD,
                TileType.IND_LIGHT,
                TileType.IND_HEAVY,
            )
        ]
        coverage6 = self.metrics.service_coverage
        disaster = roll_disaster(
            self.parcel.seed,
            self.at_year,
            fire_coverage=float(coverage6.get("fire", 0.0)),
            river_near=any(
                row.count(Terrain.RIVER) > 0 for row in self.parcel.terrain
            ),
            candidates=candidates,
            density=min(1.0, len(self.tiles) / 80.0),
        )
        if disaster is not None:
            self.last_disaster = disaster.to_dict()
            self._disaster_penalty = disaster.happiness
            if disaster.tile_id:
                self.built[disaster.tile_id] = 0.0
                self._targets_dirty = True
            # 灾难冲击通过 _disaster_penalty 进入 _recompute（可持久化、可重放）

        # 年度结算末尾统一重算一次：否则无灾难的年份会沿用上一年的 metrics，
        # 让在线路径带上「旧灾难惩罚」而恢复端（会 _recompute）不带 —— 实测差 6。
        self._recompute()

        self.history.append(
            {
                "year": self.at_year,
                "population": self.metrics.population,
                "jobs": self.metrics.jobs,
                "funds": self.funds,
                "happiness": self.metrics.happiness,
                "congestion": round(self.metrics.congestion, 4),
                "pollution": round(self.metrics.pollution, 4),
                "avg_commute": self.metrics.avg_commute,
                "tax_income": self.metrics.tax_income,
                "upkeep": self.metrics.upkeep,
            }
        )
        if len(self.history) > 60:
            self.history = self.history[-60:]

        labels = _year_events(before, self.metrics)
        if disaster is not None:
            labels = ([f"{disaster.kind}:{disaster.tile_id or '-'}"] + labels)[:2]
        if self.current_event:
            labels = (labels + [EVENT_LABELS[self.current_event]])[:2]
        self.low_happiness_streak = (
            self.low_happiness_streak + 1
            if self.metrics.happiness < EXODUS_THRESHOLD
            else 0
        )
        return labels

    def set_city_policy(self, policy: str, enabled: bool) -> bool:
        """开关一条城市政策；未知政策返回 False。"""
        from app.sim.policies import CITY_POLICIES

        if policy not in CITY_POLICIES:
            return False
        if enabled:
            self.city_policies.add(policy)
        else:
            self.city_policies.discard(policy)
        self._recompute()
        return True

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
            "built": self.built,
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
            "clock": self.clock.snapshot(),
            "demand": self.demand.snapshot(),
            "gate": self.gate.snapshot(),
            "builds_total": self.builds_total,
            "builds_by_type": self.builds_by_type,
            "budget": self.budget.to_snapshot(),
            "income_milli": self._income_milli,
            "expense_milli": self._expense_milli,
            "citizens": self.citizens.to_snapshot(),
            "districts": self.districts.to_snapshot(),
            "transit": self.transit.to_snapshot(),
            "city_policies": sorted(self.city_policies),
            "history": self.history,
            "weather": self.weather.to_dict() if self.weather else None,
            "disaster_penalty": self._disaster_penalty,
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
            clock=SimulationClock.from_snapshot(snapshot.get("clock", {})),
            demand=Demand.from_snapshot(snapshot.get("demand", {})),
            gate=BuildGate.from_snapshot(snapshot.get("gate", {})),
            builds_total=snapshot.get("builds_total", 0),
            builds_by_type=dict(snapshot.get("builds_by_type", {})),
            built={key: float(value) for key, value in snapshot.get("built", {}).items()},
            budget=CityBudget.from_snapshot(snapshot["budget"])
            if snapshot.get("budget")
            else CityBudget(),
            _income_milli=int(snapshot.get("income_milli", int(float(snapshot.get("income_accum", 0.0)) * 1000))),
            _expense_milli=int(snapshot.get("expense_milli", int(float(snapshot.get("expense_accum", 0.0)) * 1000))),
            citizens=CitizenPool.from_snapshot(snapshot.get("citizens")),
            districts=DistrictManager.from_snapshot(snapshot.get("districts")),
            transit=TransitManager.from_snapshot(snapshot.get("transit")),
            city_policies=set(snapshot.get("city_policies") or []),
            history=list(snapshot.get("history") or []),
            weather=_weather_from_snapshot(snapshot.get("weather")),
            last_disaster=snapshot.get("last_disaster"),
            _disaster_penalty=int(snapshot.get("disaster_penalty", 0)),
        )
        # 快照里已有完整指标时直接恢复，不再重算：重算会把 `metrics.funds`
        # 拉回 `state.funds`，而两者在一年最后几帧可能相差一次未结算的日结，
        # 导致「重启后状态 == 在线状态」的断言失败。C:S 的存档同样是全量存储。
        if snapshot.get("metrics"):
            state.metrics = Metrics.model_validate(snapshot["metrics"])
            state.funds = state.metrics.funds
        return state
