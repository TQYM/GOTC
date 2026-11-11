# 14 · CITY20 交付说明（按 C:S 复刻版）

## 怎么跑

```bash
# 后端
cd backend
pip install -e ".[dev]"        # 或用现有 venv
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm ci
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

打开 `http://localhost:3000` → 创建城市 → 开始。

## 第一次玩

1. 底部工具栏选「低密住宅」，在地图上点空地放下第一栋。
2. 顶部中央速度档点 ▶▶▶，让模拟跑起来。
3. 左下角三条竖条是 RCI 需求；需求高时才会继续长楼。
4. 工具栏切「批量划区」，拖矩形一次放多块（商业/工业只有划出来才会长）。
5. 左侧财政面板调税率、借贷款；右侧政策面板开城市政策。
6. 顶部里程碑条显示当前档位与下一个解锁。

## 已复刻的 C:S 机制

| 机制 | 实现 |
|---|---|
| 帧时钟 + 速度档 | `SPEED_FRAMES = {0:0,1:1,2:2,3:4}`，3 档实为 4 倍速（与 C:S 一致） |
| 暂停仍跑 subStep 0 | 暂停时 `SimulationStep(0)` 照跑，只是不推进帧号 |
| 需求双轨 | `actual_*` 驱动建造，`displayed_*` 只喂 UI |
| 建造闸门 | 每 8 帧开一次、建一栋即停（`BuildGate`） |
| 划区 ≠ 建成 | `built[tile_id]` 建成度 0..1，20 次填满 |
| 建筑升级 | 地价 > 55 才有概率升 `res_low → res_mid → res_high` |
| 历史建筑 | `historical` 钉住单栋退出升级 |
| 建筑改名 | `name` 进存档 |
| 建筑搬迁 | `POST …/relocate`，保留建成度/名称/历史标志，收 30% 造价 |
| 账本 + 日结算 | 5 类 × 16 段，256 帧 = 1 预算日 |
| 税率 | 5 类 × 1..29，默认 9，直接乘税收 |
| 贷款 | 按剩余期数摊销，30 日还一次 |
| 城市政策 | 5 条，累乘到通勤/污染/维护/税收 |
| 行政区 + 政策 | 6 条区政策，含互斥组 |
| 市民个体 | 800 代理 × scale，年龄/教育/就业/幸福/通勤 |
| 道路等级 | 道路 ×1 / 大道 ×2 / 高速 ×3 容量 |
| 公交/地铁线路 | >2 站成线，600m 接驳，站点必须挂线才载客 |
| 市政服务 | 6 类 + 覆盖半径 + 覆盖率惩罚 |
| 灾难 | 火灾/内涝/陨石，确定性抽取，消防覆盖降低火灾 |
| 天气 | 5 种 × 四季，乘数作用于通勤/污染/维护 |
| 统计 | 逐年 history，保留 60 年，前端 4 条 sparkline |
| 里程碑 | 5 档 + 解锁预览 |
| 信息视图 | 6 种：地价/污染/交通/幸福/就业 + 默认 |
| 存档一致 | 在线增量 / 最新快照+增量 / 全量重放 三条路径逐比特一致 |

## 已知限制

- 建筑搬迁的前端入口用 `window.prompt` 输入 `r,c`（3D 点选选址未做）。
- 新局没有 C:S 的「预跑 16384 帧」，城市从零开始长。
- 市民是统计代理，不是逐个寻路的个体（C:S 也是三级 LOD，但这里是纯统计）。
- 道路是格网加权，没有节点/路段拓扑与转向限制。
- 存档是整体快照 + 操作重放，不是 C:S 的三段式 `Early/Update/LateUpdateData`。
- 日夜两套预算未拆（C:S 的 `m_serviceBudgetDay/Night`）。

## 验证

```bash
cd backend && python3 -m pytest -q          # 只剩预存失败 test_old_sessions_routes_are_not_exposed
cd frontend && npx tsc --noEmit && npm test -- --run && npm run build
```

预存失败说明：`tests/saves/test_api.py::test_old_sessions_routes_are_not_exposed`
期望 404 实得 405，改造前即存在，与本次复刻无关。
