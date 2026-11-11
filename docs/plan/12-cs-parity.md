# C:S 功能复刻对照表

> 目标（用户 2026-11-10）：「照着都市天际线修改我们的，要做到除了外观和地图剩下的基本一摸一样」。
> 本文是验收依据：左边是 Cities: Skylines 1 的机制（来自 `reports/30-simulation-logic-analysis.md` 的官方源码实证），右边是 CITY20 的实现位置。
>
> 状态：✅ 已实现并测试 ｜ 🟡 部分实现 ｜ ⬜ 未实现

## 一、时间与推进

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 固定帧 tick（`SimulationStep(subStep)`） | `SimulationManager.cs:869-960` | `backend/app/sim/clock.py` | ✅ |
| 速度档 1x/2x/3x，**3x 实际 4 帧** | `SimulationManager.cs:462-490` | `SPEED_FRAMES = {0:0,1:1,2:2,3:4}` | ✅ |
| 暂停 ≠ 停止（仍跑 `subStep=0`） | 同上 | `sub_steps()` 暂停返回 `[0]` | ✅ |
| 调速度自动取消暂停 | `:436-452` | `set_speed` | ✅ |
| 日/年双时间轴 | `m_timePerFrame=147.65625s`、`DAYTIME_FRAMES=65536` | `FRAMES_PER_DAY=10`、`FRAMES_PER_YEAR=3600` | ✅ |
| 新局预跑 16384 帧再回拨 | `:997-1012` | 未做（CITY20 首年从空城开始） | ⬜ |
| 模拟线程 + 背压（`m_maxFramesBehind=14`） | `:794-868` | asyncio 定时循环（`SIM_TICK_SEC=1/12`） | 🟡 |

## 二、需求与建造

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 需求双轨：`m_actual*`（真值）vs `m_*Demand`（显示） | `ZoneManager.cs` | `backend/app/sim/demand.py` 的 `actual_*` / `displayed_*` | ✅ |
| 显示值平滑靠拢真值 | CSM `DemandExtension` | `Demand.smooth(0.10)` | ✅ |
| 建造闸门：每 8 帧开一次，一栋即停 | `ZoneManager.cs:910-937` | `backend/app/sim/gate.py` | ✅ |
| 建成度（划区 ≠ 建成） | `Building.Flags.Created` | `CityState.built: dict[tile, 0..1]` | ✅ |
| 地块优先抽样（避免高需求类别吃光机会） | — | `CityState._try_build` | ✅ |
| 地价驱动升级（低→中→高） | `PrivateBuildingAI` | `CityState._try_upgrade`（每 1024 帧） | ✅ |
| 建筑上限 49,152 = 256×192 分片 | `BuildingManager.MAX_BUILDING_COUNT` | 未设硬上限（48×48 地图天然封顶） | 🟡 |

## 三、经济

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 16 段日账本 + 当日累计 | `EconomyManager` 的 182×17 | `backend/app/sim/budget.py` 的 5 类×16 段 | ✅ |
| 256 帧 = 1 预算日 | `(frame>>8)&0xF` | `SEGMENTS_PER_DAY=16`、`FRAMES_PER_SEGMENT=16` | ✅ |
| 税率四维（service×subService×level）+ 政策 ±2 | `EconomyManager.cs:960-1010` | `tax_rates[Service]` + `POLICY_TAX_DELTA=2` | 🟡（收敛为 5 类） |
| 贷款按「期数」摊销 | `Loan` | `budget.Loan.monthly_payment()` | ✅ |
| 破产纾困（bailout，有冷却） | `m_lastBailoutFrame` | `CityState.bankrupt` 判定 | 🟡（无纾困弹窗） |
| 日夜两套预算 | `m_serviceBudgetDay/Night` | 未做 | ⬜ |

## 四、市民

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 三级结构：Citizen 104 万 / Unit 52 万 / Instance 6.5 万 | `CitizenManager.cs` | `CitizenPool`：800 代理 × scale | 🟡（按代理抽样） |
| 频率分级（4096 / 4096 / 16 帧） | `SimulationStepImpl` | 代理按年推进（对齐到 settle_year） | 🟡 |
| 年龄 / 教育 / 就业 / 幸福 | `CitizenAI` | `citizens.advance_year()` | ✅ |
| 确定性（跨 replay 一致） | `Randomizer(unit)` | blake2b `_unit()` | ✅ |
| 空间 LOD（`view.position + direction*200`） | `CitizenManager.cs:1727` | 未做（无个体渲染） | ⬜ |

## 五、区划与行政区

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 区划刷子（拖拽批量） | `ZoneTool` | `POST /zone {rows, cols}` + `TileSheet` 刷子 | ✅ |
| 行政区（id 是 byte，≤256） | `DistrictManager.CreateDistrict(out byte)` | `DistrictManager`（`MAX_DISTRICTS=256`） | ✅ |
| 区政策（位标志，互斥组） | `m_districtPolicies` | `POLICIES` + `EXCLUSIVE` | ✅ |
| 城市级政策 | `SetCityPolicy` | 未做（只有区级） | ⬜ |
| 地块命名（区/道路/建筑） | `SetDistrictName` 等 | 未做 | ⬜ |

## 六、交通

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 道路等级（两车道/四车道/高速） | `NetInfo.m_halfWidth` 等 | `trans_road` / `trans_avenue` / `trans_highway` | ✅ |
| 路径选择 + 拥堵（BPR） | `PathManager` | `traffic.py` 的 `_dijkstra_to_nearest_job` + BPR | ✅ |
| 公共交通线路（画线、设站、票价） | `TransportLine` | `transit.py` + `TransitPanel` + 3D 线路 | ✅ |
| 站点必须挂线才载客 | `TransportLine.m_stops` | `best_transit_minutes` 要求同线两站 | ✅ |
| 寻路线程池（clamp(CPU/2,1,4)） | `PathManager.cs:205-218` | 单线程同步（48×48 规模够用） | 🟡 |
| 节点/路段拓扑（`NetNode`/`NetSegment`） | `NetManager` | 格网 + 道路格（无节点概念） | 🟡 |
| 出发后不改路线（结构性） | `PathUnit.Position` 三元组 | 每次重算全量分配 | 🟡 |

## 七、服务与灾难

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 服务覆盖（警/消/医/教育/垃圾/污水/水电） | `CoverageManager` | `services.py`：6 类 + 覆盖率惩罚 | ✅ |
| 覆盖不足 → 岗位/污染/幸福惩罚 | — | `service_effects()` | ✅ |
| 灾难（火灾/内涝/陨石） | `DisasterManager` | `disasters.py`（确定性） | ✅ |
| 灾难损毁建筑 | `DisasterAI` | `built[victim] = 0.0` | ✅ |
| 天气（云/雨/雾/温度） | `WeatherManager` | `weather.py`（四季 + 5 种天气 + 乘数） | ✅ |
| 极光 / 彩虹 | `m_northernLights` | 未做 | ⬜ |

## 八、交互层

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 工具状态机（`OnToolLateUpdate` → 命令） | `BuildingTool` / `NetTool` | 前端 `TileSheet` + `zoneAt` / `buildAt` | 🟡 |
| `IsInsideUI` 统一阻挡 | `ToolController.IsInsideUI` | 各面板 `pointer-events-auto` | 🟡 |
| 信息视图（23 种） | `InfoManager.CurrentMode` | 4 种（地价/污染/交通/默认） | 🟡 |
| 服务覆盖圈渲染 | — | `ServiceRings` | ✅ |
| 需求条 / 速度档 / 财政面板 / 市民面板 / 区面板 / 线路面板 / 统计面板 / 里程碑条 | — | 8 个 HUD 组件 | ✅ |
| 建筑拆除确认 | `BulldozeTool` | `RemoveConfirm` | ✅ |
| 历史建筑（钉住不拆） | `Building.Flags.Historical` | 未做 | ⬜ |
| 建筑搬迁 | `RelocateBuilding` | 未做 | ⬜ |

## 九、存档

| C:S 机制 | 源码依据 | CITY20 | 状态 |
|---|---|---|---|
| 三段式 `EarlyUpdateData → UpdateData → LateUpdateData` | `ISimulationManager` | 单段 `to_snapshot()` / `from_snapshot()` | 🟡 |
| 全量快照（不重算） | `m_serializableDataStorage` | 快照含 `metrics`/`budget`/`citizens`/`transit`/`weather` | ✅ |
| 事件溯源 + 定期快照 | — | `repository.append_operation` + `snapshot_interval=50` | ✅ |
| replay == 在线（确定性） | `Randomizer` | blake2b + 无隐藏状态 + 整数毫单位累加账本 | ✅ |
| Historical 标志 | `Building.Flags` / `BuildingSetHistoricalCommand` | `Tile.historical`，跳过升级 | ✅ |
| 建筑自定义名称 | `SetBuildingName` | `POST …/rename`，`Tile.name` | ✅ |
| 城市级政策 | `DistrictManager.SetCityPolicy` | 5 条城市政策（免费公交/禁烟/回收/电动车/夜间预算） | ✅ |
| 天气乘数 | `WeatherManager` | 5 种天气 × 通勤/污染/维护 | ✅ |
| 里程碑 | `UnlockManager` | 5 档人口里程碑 + 解锁预览 | ✅ |

## 十、还没做的

按「对玩法影响」排序：

1. **建筑搬迁**——C:S 可以把整栋楼挪走；现在只能拆了重建。
2. **信息视图补到 10+ 种**——现在 6 种（默认/地价/污染/交通/幸福/就业）。
3. **日夜两套预算**——现在只有一套（C:S 是 `m_serviceBudgetDay/Night`）。
4. **新局预跑**——现在首年从空城开始，C:S 会先跑 16384 帧 ≈28 天。
5. **市民个体渲染**——现在只有统计，没有「街上有人」。
6. **节点/路段拓扑**——现在道路是格网，没有路口转向限制。
7. **三段式存档**——现在单段快照，C:S 是 Early/Update/Late 三段。
