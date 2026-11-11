# 13 · 按 Cities: Skylines 复刻 CITY20（改造日志）

> 依据：`/Users/tqym_16/reverse/cities-skylines/` 下的三份逆向报告
> （`reports/10-acquisition-and-unpack.md`、`20-user-operation-analysis.md`、
> `30-simulation-logic-analysis.md`）与 `intel/evidence.md` 的官方源码行号证据。
> 原则：**除外观（卡通 3D）与地图（北京真实片区）外，模拟/操作/经济/UI 结构对齐 C:S。**

## 1. 时间模型

| C:S | CITY20 |
|---|---|
| 固定帧 tick，`SimulationStep(subStep)` | `SimulationClock` + `advance(frames)` |
| 速度档 0/1/2/3，3 档实为 4 帧 | `SPEED_FRAMES = {0:0, 1:1, 2:2, 3:4}` |
| 暂停 `subStep == 0` 仍跑一遍 | `sub_steps()` 暂停返回 `[0]` |
| 一日 585.14 帧 / 昼夜 65536 帧双轴 | `FRAMES_PER_DAY = 10` / `FRAMES_PER_YEAR = 3600` |
| 新局预跑 16384 帧 | 未实现（见 §10） |

## 2. 需求与建造

- **需求双轨**：`Demand.actual_*`（真值，驱动建造）与 `displayed_*`（UI 条，`smooth(0.10)` 向真值靠拢）。
- **建造闸门**：`BuildGate(open_interval=8)`，同窗口只放行一次 —— 复刻 `ZoneManager` 每 8 帧开闸、建一栋即停。
- **建成度 `built: dict[tile_id, 0..1]`**：划区 ≠ 建成；`BUILD_PER_FRAME = 0.05`，20 次填满一栋。
- **三类地块共用一条闸门**：住宅/商业/工业各自按需求概率决定是否落成，避免高需求类别吃光机会。
- **建筑升级**：每 1024 帧一次，地价 > 55 才有概率（`(price-50)/200`），`res_low → res_mid → res_high`。
- **历史建筑**：`Tile.historical` 钉住单栋退出升级（对应 `BuildingSetHistoricalCommand`）。

## 3. 经济

- **账本**：`CityBudget.income/expenses` 各 5 类 × 16 段，`256 帧 = 1 预算日`，每 `frame % 256 == 0` 结算。
- **整数毫单位累加**：`_income_milli += tax_income * 1000 // frames_per_year` —— 浮点会让 200 年重放差 1 元。
- **税率**：5 类 × 1..29，默认 9（对齐 C:S 默认档），`tax_income = base * (rate / 9)`。
- **贷款**：`Loan(principal, remaining, rate_bp, months, months_left)`，按剩余期数摊销，30 日还一次。
- **城市政策**：免费公交 / 禁烟 / 回收 / 电动车 / 夜间预算，累乘到通勤、污染、维护、税收。

## 4. 市民

- `CitizenPool`：800 代理 × `scale`，等价于 C:S 的 Citizen/CitizenUnit/CitizenInstance 三级统计形状。
- 属性：年龄 / 教育（4 档）/ 就业 / 幸福 / 通勤。
- **确定性哈希**：`_unit(*parts)` 用 blake2b，替代 `random.Random` —— 在线与 replay 必然一致。
- **快照存整段 agents**：年龄是逐年演化的状态，只存 population 会让恢复端从初始金字塔重建。

## 5. 行政区与政策

- `DistrictManager`：矩形圈地，id 上限 256（C:S 的 district id 是 `byte`）。
- 6 条政策：高税率 / 低税率（互斥）、限制重工业、绿色城区、教育优先、工业扶持。
- `effects()` 聚合出税率、污染、幸福、教育、岗位、禁建类型，接入 `_recompute` 与 `_try_build`。

## 6. 交通

- 格网 + 道路加权 + BPR（`t0 * (1 + alpha*(v/cap)^beta)`）。
- **道路等级**：道路 ×1 / 大道 ×2 / 高速 ×3 容量，代价递减。
- **公交/地铁线路**：`TransitManager`，>2 站成线，600m 步行接驳，站间时间 = 站数 × 制式分钟数。
- 站点必须挂在线路上才载客 —— C:S 的站点本身不产生运力。

## 7. 市政服务与灾难

- 6 类服务：警察 / 消防 / 垃圾 / 污水 / 电厂 / 水厂，各有服务半径。
- 覆盖率不足 → 幸福惩罚（上限 -8）、污染加成、岗位折损。
- 3 种灾难：火灾 / 内涝 / 陨石，blake2b 确定性抽取，消防覆盖降低火灾概率。
- 灾难当年 `_disaster_penalty` 进入 `_recompute`（可持久化、可重放）。

## 8. 天气与统计

- 5 种天气 × 四季，乘数作用于通勤 / 污染 / 维护。
- `history` 逐年快照（人口/岗位/资金/幸福/拥堵/污染/通勤/税收/维护），保留 60 年。
- 5 档人口里程碑 + 解锁预览（只展示，不硬校验）。

## 9. 存档一致性（关键教训）

三条路径必须逐比特一致：**在线增量** / **最新快照 + 增量** / **seq=0 全量重放**。

踩过的坑：

1. `budget` 与累加器没进快照 → 每次 `apply` 都把日账本清零。
2. 浮点累加器 → 200 年后差 1 元；改整数毫单位。
3. 市民池 `sync` 的「1% 变化才同步」守卫 → 依赖 `_recompute` 调用次数；去掉。
4. `_next_id` 自增 → 重放与恢复的 cid 段错位；改用 `len(agents)` 稠密分配。
5. 灾难惩罚写进 `metrics` 而非派生量 → 恢复端被 `_recompute` 抹掉；改为 `_disaster_penalty` 参与重算。
6. 年度结算未必调 `_recompute` → 无灾难年沿用上一年 metrics；结算末尾统一重算。

## 10. 尚未实现

建筑搬迁、日夜两套预算、新局预跑 16384 帧、市民个体 3D 渲染、节点/路段拓扑与转向限制、三段式存档（`EarlyUpdateData/UpdateData/LateUpdateData`）。

## 11. 验证

```bash
cd backend && python3 -m pytest -q
cd frontend && npx tsc --noEmit && npm test -- --run && npm run build
```

唯一预存失败：`tests/saves/test_api.py::test_old_sessions_routes_are_not_exposed`
（期望 404 实得 405，改造前即存在）。
