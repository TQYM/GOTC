# 02 · 前后端数据契约

> **本文档是前后端两位开发者之间的唯一接口约定。** 后端按本文档产出数据，前端按本文档消费数据；任何一方不得单方面变更。修改流程：提议方改本文档 → 双方在对应 PR 下确认 → 合并后生效。

## 0. 协作约定（先读）

### 0.1 契约纪律

- 字段**只增不改不删**。废弃字段标注 deprecated，至少保留一个里程碑再移除。
- 字段名、枚举值、错误码全部小写蛇形（字段）/小写（枚举与错误码），见各表。
- 所有金额单位为**元**（整数），所有时间单位为**秒**（整数），比率统一 0–1 小数。
- 后端是游戏时间与游戏状态的**唯一权威**：倒计时、阶段切换、合法操作判定全部以后端为准，前端永不本地推断"这步能不能走"。

### 0.2 并行开发策略（两人怎么不互相等）

| 阶段 | 后端交付物 | 前端交付物 | 联调点 |
|---|---|---|---|
| 契约冻结后 | 按本文档 §3 返回**固定假数据**的桩接口（PR-03，半天内） | 按 §2 纯前端跑通页面与交互（用本地 mock 数据） | 无需联调 |
| 桩接口合并后 | 接口不变，内部逐步替换为真 sim / 真 AI | 前端把 mock 数据源切到真后端（只需改 baseURL 与鉴权头） | **联调点 A**：地块渲染 + 放置回显（M1） |
| SSE 桩就绪后 | SSE 先推固定文案的假事件流 | 前端信息流组件消费真流 | **联调点 B**：三栏信息流（M3） |
| 全量替换后 | 数值与文案全部来自真引擎 | 完整一局 | **联调点 C**：20 分钟完整局 + 报告（M4） |

> 关键原则：**前端 mock 数据必须按本文档的 JSON 形状造**。这样切真后端时零改动，联调成本降到最低。前端仓库内允许保留一个 mock 开关（环境变量控制），演示/联调两相宜。

### 0.3 通用约定

- Base URL：同源部署（Next.js 的 API 路由或反代转发到 FastAPI），前端开发态用环境变量 `API_BASE` 指向本地 8000 端口。
- 请求/响应一律 UTF-8 JSON；SSE 单独走 `/api/sessions/{id}/stream`。
- 会话无鉴权（比赛项目），会话 ID 即权限凭证，不展示不传播即可。

## 1. 错误协议

所有 REST 错误返回统一信封：

```json
{
  "error": {
    "code": "invalid_placement",
    "message": "目标格子不可建设（terrain=river）",
    "details": { "cells": [[12, 7]] }
  }
}
```

| HTTP 状态 | code | 含义 | 前端处理 |
|---|---|---|---|
| 400 | invalid_placement | 放置不合法（地形/占用/越界/锚点覆盖非法格） | 红框提示 + 播放错误动效，不改本地状态 |
| 400 | invalid_phase | 当前阶段不允许此操作（如 locked 期尝试放置） | toast + 按钮置灰 |
| 402 | insufficient_funds | 财政资金不足 | toast + 金额闪红 |
| 404 | session_not_found | 会话不存在或已过期 | 引导回首页重开 |
| 409 | cell_occupied | 目标格已有区块 | 同 invalid_placement |
| 422 | invalid_payload | 请求体缺字段/类型错 | 开发期告警（前端应兜底校验） |
| 500 | internal_error | 后端异常 | toast + 提供重试按钮 |

SSE 通道不报错；后端内部异常走 `error` 事件类型（§3.3）。

## 2. 数据形状（Data Shapes）

### 2.1 Parcel（地块）

```json
{
  "size": 48,
  "cell_size_m": 50,
  "terrain": [["flat","flat","hill","river","bank","flat"], ["..."]],
  "inherited_road": [[3,0],[4,1],[5,2]],
  "constraints": {
    "height_limit_m": 80,
    "green_line_m": 30,
    "buildable_ratio": 0.74,
    "briefing": "本地块限高80m，河道两侧30m绿线，省道保留不可拆。"
  },
  "seed": 882314
}
```

- `terrain`：48×48 二维数组，值为 [01 §2](01-domain.md) 地形枚举。
- `inherited_road`：省道格坐标列表（已是 terrain 中 road_inherited 格的镜像，前端可任选其一渲染）。
- `briefing`：开局简报原文（生成时由 AI 叙述层撰写；AI 不可用时用模板文案）。
- `seed`：随机种子，报告分享时可用于复现同款地块。

### 2.2 Tile（已放置区块）

```json
{
  "id": "tile_7f3a",
  "type": "res_mid",
  "anchor": [12, 7],
  "cells": [[12,7]],
  "built_at_year": 1,
  "upkeep": 12000
}
```

- `anchor`：[r, c] 锚点；`cells`：实际占格列表（多格区块多于锚点）。
- 前端渲染只信 `cells`；`anchor` 用于操作定位。

### 2.3 Metrics（指标快照）

即 [01 §4](01-domain.md) 的 14 字段，外加时间戳：

```json
{
  "at_year": 2,
  "at_phase": "build",
  "funds": 4310000,
  "population": 8200,
  "jobs": 6100,
  "job_res_ratio": 0.74,
  "land_price_index": 118.4,
  "green_ratio": 0.31,
  "avg_commute": 34,
  "congestion": 0.52,
  "pollution": 0.18,
  "happiness": 63,
  "tax_income": 1260000,
  "upkeep": 480000,
  "coverage_edu": 0.66,
  "coverage_med": 0.41
}
```

### 2.4 MetricsDiff（变化量）

```json
{
  "at_year": 2,
  "delta": { "population": 1200, "happiness": -3, "congestion": 0.08 },
  "after": { }
}
```

- `delta` 只含**发生变化**的字段；`after` 为完整快照（可选携带，前端优先用 delta 做动效）。

## 3. REST 端点

### 3.1 创建会话

`POST /api/sessions`

请求体：

```json
{ "seed": 882314 }
```

- `seed` 可选；缺省后端随机。传相同 seed 必须得到相同地块（前后端联调、demo 复现都靠它）。

响应 201：

```json
{
  "session_id": "ses_x7k2",
  "parcel": { "..." : "见 2.1" },
  "phase": "briefing",
  "time_left_sec": 20,
  "funds": 5000000
}
```

- 初始资金 500 万（`sim/config` 可调）。
- polish 期不限放置次数，契约无次数字段；阶段合法性仅由 `phase` 与时间窗控制。

### 3.2 查询会话

`GET /api/sessions/{id}`

响应 200：

```json
{
  "session_id": "ses_x7k2",
  "phase": "build",
  "time_left_sec": 512,
  "parcel": { "…": "…" },
  "tiles": [ { "…": "见 2.2" } ],
  "metrics": { "…": "见 2.3" },
  "placements_count": 23
}
```

- 前端刷新/断线重连后一次性拉全量，靠这个恢复现场。

### 3.3 放置区块

`POST /api/sessions/{id}/place`

```json
{ "type": "res_mid", "anchor": [12, 7] }
```

响应 200：

```json
{
  "tile": { "…": "见 2.2" },
  "metrics": { "…": "见 2.3 新快照" },
  "metrics_diff": { "…": "见 2.4" },
  "funds_after": 4090000
}
```

失败见 §1 错误表。**注意**：即使失败，响应也带当前最新 `metrics` 快照，前端无需二次拉取。

### 3.4 拆除区块

`POST /api/sessions/{id}/remove`

```json
{ "tile_id": "tile_7f3a" }
```

响应 200：同 3.3 结构（`tile` 为被拆区块的遗照）。拆除返还 30% 造价，计入 funds_after。

### 3.5 进入下一阶段（跳过简报 / 建设期提前锁定）

`POST /api/sessions/{id}/advance`

响应 200：`{ "phase": "build", "time_left_sec": 900 }`

### 3.6 锁定并推演

`POST /api/sessions/{id}/finalize`

仅 polish 期或 build 期可调（build 期调用 = 提前进入推演）。响应 200：

```json
{
  "phase": "locked",
  "projection": [
    { "year": 4, "metrics": { "…": "…" }, "events": ["人口流入放缓"] },
    { "year": 5, "metrics": { "…": "…" }, "events": ["cbd地价上涨12%"] }
  ],
  "ending": "thriving",
  "scores": { "population": 72, "balance": 88, "green": 64, "traffic": 51, "happiness": 77 },
  "report_text": "这座为通勤而建的城市，最终困住了所有人……"
}
```

- `projection`：10 年推演的**年度切片**（4–13 年），供前端做快进动画；`events` 是该年值得显示的文案标签（可空串，由后端模板/AI 提供）。
- `report_text`：诊断报告叙事段落（AI 不可用则为模板文案）。
- 此端点是**同步**计算（纯 sim，无 AI 调用），耗时必须 <2s；AI 文案异步补推。

### 3.7 重开

`POST /api/sessions/{id}/restart` → 等价于新建（可带相同 seed）。

### 3.8 SSE 事件流

`GET /api/sessions/{id}/stream`（text/event-stream）

事件类型与数据形状：

| 事件名 | 触发时机 | data 形状 |
|---|---|---|
| `tick` | 每次指标重算后 | 2.4 MetricsDiff |
| `phase_change` | 阶段切换 | `{"phase":"build","time_left_sec":900}` |
| `news` | 数据大脑产出 | `{"headline":"…","body":"…","severity":"info|warning|alert","at_year":2}` |
| `citizen` | 市民之声产出 | `{"persona":"程序员小李","text":"@市长 城东通勤转三趟车😡","sentiment":"angry|happy|neutral","topic":"commute"}` |
| `mentor` | 规划导师产出 | `{"comment":"…","theory_refs":["tod","life_circle_15"],"severity":"suggestion|warning"}` |
| `projection_step` | 推演进行中逐年度推送 | `{"year":4,"metrics":{ "…":"…" }}` |
| `report_ready` | 报告文案（AI 版）就绪 | `{"report_text":"…","city_name":"江湾市"}` |
| `error` | 后端内部异常通知 | `{"code":"llm_unavailable","message":"AI 叙述层暂时离线"}` |

SSE 可靠性约定：
- 每条事件带 `id:`（单调序号），前端重连时带 `Last-Event-ID` 头，后端补发断线期间事件（内存缓冲最近 200 条即可）。
- 心跳：每 15 秒一条 `tick`（即使无变化，`delta` 为空对象），前端据此显示连接状态点。
- AI 事件允许延迟 2–8 秒到达，**前端不得为此显示加载态阻塞交互**。

## 4. 契约版本

- 当前版本：**v1**（本文档随首个桩接口 PR 合并时冻结）。
- 破坏性变更（改字段名/删字段/改枚举值）必须版本号 +1，并在变更 PR 描述中写明迁移说明。
