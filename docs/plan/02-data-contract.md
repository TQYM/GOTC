# 02 · 前后端数据契约（saves v2）

> 本文件是 CITY20 前后端唯一接口约定，合并 [10](10-persistence-sync.md) 的不限时/存档/同步与 [11](11-real-beijing-3d.md) 的真实片区扩展。数值 100% 由确定性 sim 计算，AI 只生成文字。改字段、枚举、端点或事件时，必须先改本文，再改 Pydantic/TypeScript 模型与契约测试。

## 0. 通用约定

- JSON UTF-8；金额为元整数；比率为 0–1 小数；时间戳为 RFC 3339 UTC 字符串。
- 坐标为 `[row, col]`，从 0 开始；`cells` 是后端确认的覆盖格。
- 后端是合法操作、城市年份、指标和存档的唯一权威。刷新、换端、断线兜底统一 `GET /api/saves/{city_code}`。
- 所有 AI 或模板文字带 `source: "ai" | "template"`。
- 服务以**单 uvicorn worker**运行；SQLite 是唯一事实源，内存仅作热点缓存与 SSE 扇出。
- 原 `/api/sessions`、`restart`、`finalize`、`time_left_sec`、`tick` 不进入 v2 应用路由。

## 1. 错误协议

```json
{"error":{"code":"invalid_placement","message":"目标格不可建设","details":{"cells":[[12,7]]}}}
```

| HTTP | code | 含义 |
|---|---|---|
| 400 | `invalid_placement` | 地形、越界、桥几何、资产或操作规则失败 |
| 400 | `invalid_phase` | 当前存档阶段不允许操作 |
| 402 | `insufficient_funds` | 资金不足 |
| 404 | `session_not_found` | 城市码不存在（保留旧 code 字符串，语义已改为 save 不存在） |
| 409 | `cell_occupied` | 覆盖格已有玩家区块或既有资产 |
| 422 | `invalid_payload` | 请求体缺字段、类型或取值错误 |
| 500 | `internal_error` | 后端内部异常 |

共 7 个错误码。失败响应可带最新 `metrics`；SSE 内部异常用 `error` 事件。限流使用 HTTP 429，错误信封仍为 `invalid_payload`，`details.reason="rate_limited"`。

## 2. 核心数据形状

### 2.1 Parcel 与既有资产

```json
{
  "parcel_id":"beijing_cbd",
  "district_name":"朝阳 CBD–通惠河",
  "data_version":"2026.11.07",
  "size":48,
  "cell_size_m":50,
  "crs":"EPSG:32650",
  "origin":[451000.0,4433000.0],
  "bbox":[116.437,39.900,116.465,39.9216],
  "terrain":[["flat","occupied"]],
  "inherited_road":[[3,0],[4,1]],
  "constraints":{"height_limit_m":80,"green_line_m":30,"buildable_ratio":0.74,
    "briefing":{"text":"……","source":"template"}},
  "seed":882314,
  "buildings_url":"/static/parcels/beijing_cbd/buildings.json",
  "network_url":"/static/parcels/beijing_cbd/network.json"
}
```

- `bbox` 为 WGS84 `[west,south,east,north]`；`crs/origin` 描述投影与局部米制原点，`footprint/path` 使用该局部坐标，y 轴向北、网格 r=0 在北边。sandbox 的 `crs="LOCAL"`、`origin=null`。
- `terrain` 为完整方阵，枚举：`flat / hill / river / bank / forest / road_inherited / occupied`。
- `occupied / river / road_inherited` 不可普通放置；`forest` 可建设并触发抗议；`bank` 仅绿地/桥按规则使用。
- sandbox 保留：`parcel_id="sandbox"`、`district_name="自定义沙盒"`、资源 URL 为 `null`，seed 生成规则不变。
- `buildings.json` 含稳定 `ExistingAsset[]`：`asset_id/category/height_m/levels/footprint/cells/base_area_m2/population/jobs/demolition_cost/upkeep/height_source`。多格资产按 `asset_id` 整体 redevelop；multipart 资产使用稳定 `part-N` 后缀。`data_version` 同时绑定原始数据与管线配置。
- `network.json` 含道路/地铁中心线及等级；前端渲染与后端既有设施输入使用同一数据版本。

### 2.2 Tile

```json
{"id":"tile_00000001","type":"res_mid","anchor":[12,7],"cells":[[12,7]],
 "built_at_year":1,"upkeep":12000,"orientation":null}
```

14 种 `type` 不变。仅 `util_bridge` 可携带 `orientation="horizontal"|"vertical"`。tile ID 在存档内确定分配并进入 op 结果，重放不得重新随机生成。

### 2.3 Metrics 与 MetricsDiff

`Metrics` 为 [01](01-domain.md) 的 14 指标加 `at_year/at_phase`。存档 `phase` 只有 `briefing/building`；预览切片的 `metrics.at_phase` 可为 `projecting`。

```json
{"at_year":1,"at_phase":"building","funds":5000000,"population":0,"jobs":0,
 "job_res_ratio":0,"land_price_index":100,"green_ratio":0,"avg_commute":0,
 "congestion":0,"pollution":0,"happiness":50,"tax_income":0,"upkeep":0,
 "coverage_edu":0,"coverage_med":0}
```

`MetricsDiff.delta` 只含变化后的字段值，`after` 在 REST 操作结果与 `op_applied` 中恒带完整 Metrics。

### 2.4 SaveState

```json
{
  "save_id":"sav_…","city_code":"01234567","name":"我的城市",
  "parcel":{"…":"…"},"tiles":[],"redeveloped_asset_ids":[],
  "metrics":{"…":"…"},"city_year":1,"phase":"briefing","last_seq":0
}
```

`city_year` 开局为 1；`last_seq` 是最后一个**已提交领域 op**的序号。报告、AI 事件和 project 不增加 op seq。

### 2.5 写操作公共字段与 OperationResult

`place/remove/redevelop/advance` 都含：

```json
{"client_op_id":"web-01J…-0001","base_seq":42}
```

- `client_op_id`：1–128 字符，存档内唯一；重复请求返回首次完整结果，不重复落库或广播。
- `base_seq`：客户端本地序号，仅用于回显/诊断；落后不导致拒绝。
- `seq` 在事务内分配；op、状态更新与可能的快照同一事务提交，提交后才广播。

统一结果字段：

```json
{
  "seq":43,"op_type":"place","client_op_id":"web-01J…-0001",
  "payload":{"type":"res_mid","anchor":[12,7]},
  "tile":{"…":"可空"},"tiles":[{"…":"全量玩家 tiles"}],
  "redeveloped_asset_ids":[],
  "metrics":{"…":"…"},"metrics_diff":{"at_year":1,"delta":{},"after":{"…":"…"}},
  "funds_after":4780000,"city_year":1,"annual_events":[]
}
```

`remove` 的 `tile` 是被拆区块；`advance` 的 `tile=null` 且 `annual_events` 为模板事件列表；`redevelop` 另带 `redevelopment`：

```json
{"asset_id":"b123","cells":[[10,10],[10,11]],"demolition_cost":120000,
 "population_removed":80,"jobs_removed":0,"happiness_delta":-5,"penalty_until_year":4}
```

`penalty_until_year` 为排他截止年：第 1 年更新时截止第 4 年，因此第 1/2/3 年幸福度附加 -5，第 4 年自动消失；多次更新延长截止年但不叠加数值。现状维护费与人口/岗位税收随有效资产一次性增减。

### 2.6 Projection

```json
{"projection_id":"prj_…","base_year":4,"base_seq":42,
 "projection":[{"year":5,"metrics":{"…":"…"},"events":["拥堵突破阈值"],"source":"template"}]}
```

`years` 默认 10，范围 1–20。project 在快照副本上运行，**不写 ops/saves/snapshots/reports，不推进城市年份或资金**。返回后由前端 ProjectionPlayer 播放；服务端可广播相同切片，所有切片携带 `base_year/base_seq`。

### 2.7 Report

```json
{
  "report_id":"rpt_…","created_at":"2026-11-07T05:00:00Z",
  "base_year":4,"base_seq":42,
  "scores":{"population":60,"balance":70,"green":50,"traffic":65,"happiness":72},
  "ending":"ordinary","report":{"overview":"……","dimensions":{"population":"……",
    "balance":"……","green":"……","traffic":"……","happiness":"……"},
    "ending_story":"……","source":"template"},
  "city_name":"我的城市","city_name_source":"template"
}
```

报告反映**当前报告时点**，不是终局；`ending` 的 UI 文案为「城市体检标签」。报告可重复生成，历史仅保留最近 20 份。REST 可先返回模板版；若 AI 后续成功，以相同 `report_id` 更新并广播 `report_ready`，数值分数不变。

## 3. REST API

| 方法与路径 | 请求 | 成功响应 |
|---|---|---|
| `POST /api/saves` | `{seed?, name?, parcel_id?}`；默认 `beijing_cbd`，`sandbox` 使用 seed | 201 SaveState |
| `GET /api/saves/{city_code}` | — | SaveState |
| `POST /api/saves/{city_code}/start` | `{}` | SaveState；briefing→building，重复调用返回当前状态 |
| `POST …/place` | `{type, anchor, orientation?, client_op_id, base_seq}` | OperationResult |
| `POST …/remove` | `{tile_id, client_op_id, base_seq}` | OperationResult |
| `POST …/district` | `{name, anchor, rows: 1..16, cols: 1..16, client_op_id}` | OperationResult（`op_type="district"`）；矩形圈地，只收已存在地块，等价于 C:S 的行政区刷子 |
| `POST …/district/policy` | `{did, policy, enabled, client_op_id}` | OperationResult（`op_type="district_policy"`）；6 条政策，互斥组自动替换 |
| `POST …/historical` | `{tile_id, historical: true, client_op_id}` | OperationResult（`op_type="historical"`）；C:S 的 Historical 标志，钉住单栋退出升级 |
| `POST …/rename` | `{tile_id, name: 0..32 字, client_op_id}` | OperationResult（`op_type="rename"`）；建筑自定义名称，空串表示清除 |
| `POST …/zone` | `{type, anchor, rows: 1..16, cols: 1..16, client_op_id}` | OperationResult（`op_type="zone"`）；逐格放置、越界/占用/资金不足只跳过不报错，等价于 C:S 的拖拽刷子 |
| `POST …/redevelop` | `{anchor, client_op_id, base_seq}` | OperationResult + redevelopment |
| `POST …/advance` | `{client_op_id, base_seq}` | OperationResult，城市年份 +1 并写回 |
| `POST …/speed` | `{speed: 0\|1\|2\|3}` | SimTickEvent；0=暂停，1/2/3 对应 1/2/4 帧每 tick（复刻 C:S 的 3x=4 帧） |
| `POST …/tax` | `{service: residential\|commercial\|industrial\|office\|utility, rate: 1..29}` | `{service, rate, view}`；税率四维模型的扁平版（C:S 的 182 类在 CITY20 收敛为 5 类） |
| `POST …/loan` | `{amount: 10000..20000000, months?: 12..120 = 60, rate_bp?: 0..3000 = 500}` | `{principal, remaining, monthly_payment, months, rate_bp, view}`；本金即时到账，按剩余期数摊销本息 |
| `POST …/project` | `{years?=10}` | ProjectionResult，不写回 |
| `POST …/report` | `{}` | ReportResult，写报告历史，不写领域 op |
| `GET …/reports` | — | `{reports: ReportResult[]}`，新到旧，最多 20 |
| `POST …/mentor` | `{}` | 202 `{accepted:true}`；结果通过 mentor 事件推送 |
| `GET …/events` | SSE，支持 `Last-Event-ID` | 见 §4 |

- `start` 以外，place/remove/redevelop/advance/project/report/mentor 仅允许 building。
- 普通拆除只针对玩家 tile；既有资产只能 redevelop，且按覆盖格找到资产后整栋处理。
- redevelop 后对应格变 flat、资产失效，可继续 place；恢复状态含 `redeveloped_asset_ids`。
- 城市码为 8 位 Crockford Base32，字符集 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`，唯一生成；知道城市码即可共同经营，无账号体系。
- 重开 = 新建 save；不提供数据删除、离线编辑或多人对战接口。

## 4. SSE v2

`GET /api/saves/{city_code}/events` 返回 `text/event-stream`。领域事件有单调整数 `id`；op seq 与 SSE event id 是两套序号。每 15 秒发送 SSE comment `: heartbeat`，**不发送 tick**。

| event | data |
|---|---|
| `snapshot` | 完整 SaveState；新连接、缓冲溢出、重启无法补发时发送 |
| `op_applied` | 完整 OperationResult；place/remove/redevelop/advance 均广播 |
| `city_year` | advance 的完整 OperationResult；与 op_applied 使用相同 seq/client_op_id，客户端须幂等 |
| `phase_change` | `{phase,city_year}`；目前用于 briefing→building |
| `news` | headline/body/severity/at_year/source |
| `citizen` | persona/text/sentiment/topic/source |
| `mentor` | comment/theory_refs/severity/top_issues/source |
| `projection_step` | ProjectionYear + projection_id/base_year/base_seq |
| `report_ready` | 完整 ReportResult |
| `sim_tick` | `{frame,year,speed,paused,hour,demand{residential,commercial,workplace},
builds_total,citizens{population,agents,scale,avg_age,avg_happiness,avg_commute,employment_rate,education_dist,age_dist},districts[{did,name,tiles[],policies[]}],budget{funds,day_income,day_expenses,debt,tax_rates,income_by_service,expenses_by_service},metrics}`；实时循环每 8 tick 广播一次（约 0.67 秒），暂停时仍发但 `frame` 不前进 |
| `speed_change` | 同 `sim_tick` 形状；`POST …/speed` 后立即广播 |
| `tax_change` | 同 `sim_tick` 形状；`POST …/tax` 后立即广播 |
| `budget_change` | 同 `sim_tick` 形状；`POST …/loan` 后立即广播 |
| `error` | `{code,message}` |

恢复规则：

1. 先订阅再决定补发/快照，cutoff 前去重，避免竞态丢事件。
2. Last-Event-ID 在 200 条缓冲内则补发；无缓冲、已溢出或进程重启无法确认时发送 `snapshot`。
3. 客户端收到 op：seq 连续且不是本端已应用 `client_op_id` 才应用；跳号直接 GET 全量恢复。
4. 本端 REST 已先应用结果，收到自己的广播时只更新回显，不重复落格。
5. snapshot 总是整体替换本地城市状态；projecting/report 本地 UI 状态不被他端强制切换。

## 5. AI 触发与降级

- news 阈值与 8 秒节流、citizen 敏感度路由保持不变；redevelop 作为新的操作原因进入同一链路。
- mentor 在每 10 个已提交领域 op 后自动触发一次，也可 `POST …/mentor` 主动触发；不再有 90 秒定时器。
- 所有 AI 调用异步于写库；失败、超时或解析失败使用模板，绝不改变指标、seq、城市年份或操作结果。
- report 的 scores/ending 由 sim 计算；AI 只能替换结构化叙述字段。

## 6. 持久化最小状态

快照/重放必须覆盖：parcel 与数据版本、完整 SimConfig、tiles、现状资产及维护费、实际入住、资金、city_year、phase、forest/环境事件、低幸福度连续年数、redeveloped 资产与惩罚期限、last_seq，以及 C:S 结构的模拟状态：`clock{frame,speed}`、`demand{actual_*,displayed_*}`、`gate{open_interval,last_window}`、`built{tile_id: 0..1}`、`builds_total`、`builds_by_type`、`budget{income[16],expenses[16],tax_rates,loans,day_income,day_expenses,last_day}`，两个浮点累加器 `income_accum`/`expense_accum`（攒够 1 元才落账，避免每帧取整丢失），行政区 `districts{next_id,districts[{did,name,tiles[],policies[]}]}`（C:S 的 `DistrictManager`：id 单调递增、政策是位标志、互斥组见下），以及市民代理池 `citizens{population,scale,next_id,agents[]}`（C:S 三级市民结构的抽样版：每个代理代表 `scale` 人，含年龄/教育/就业/幸福/通勤；生命周期用确定性哈希推进，保证 replay 与在线一致）。ops 同时保存规范命令 payload 与首次 `result_json`；每 50 op 打快照，恢复为「最近快照 + 增量重放」。

当前契约版本为 **v2**；后续破坏性变更必须继续升版本并提供迁移说明。
