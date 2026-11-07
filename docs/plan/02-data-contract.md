# 02 · 前后端数据契约

> 本文件是 CITY20 v1 的唯一接口约定。数值由确定性 sim 引擎计算，AI 只生成文字；契约字段、枚举、阶段限制和事件名必须同步修改本文档、Pydantic 模型与契约测试。

## 0. 通用约定

- JSON 使用 UTF-8；金额为元整数，时间为秒整数，比率为 0–1 小数。
- 后端是阶段、倒计时、合法操作和终局结果的唯一权威。前端刷新通过 `GET /api/sessions/{id}` 恢复完整状态。
- 所有 AI 或模板生成的文字都带 `source: "ai" | "template"`。
- 坐标为 `[row, col]`，从 0 开始；地块为 48×48，`cells` 是后端最终确认的覆盖格。

## 1. 错误协议

所有 REST 错误使用统一信封：

```json
{"error":{"code":"invalid_placement","message":"目标格不可建设","details":{"cells":[[12,7]]}}}
```

| HTTP | code | 含义 |
|---|---|---|
| 400 | `invalid_placement` | 地形、越界、桥几何或其他放置规则失败 |
| 400 | `invalid_phase` | 当前阶段不允许操作 |
| 402 | `insufficient_funds` | 资金不足 |
| 404 | `session_not_found` | 会话不存在或已过期 |
| 409 | `cell_occupied` | 覆盖格已有区块 |
| 422 | `invalid_payload` | 请求体缺字段或类型错误 |
| 500 | `internal_error` | 后端内部异常 |

共 7 个错误码。SSE 内部异常使用 `error` 事件，不改变 REST 错误表。

## 2. 数据形状

### 2.1 公共文字

```json
{"text":"本地块限高80m……","source":"template"}
```

### 2.2 Parcel

```json
{
  "size":48,"cell_size_m":50,
  "terrain":[["flat","river"]],
  "inherited_road":[[3,0],[4,1]],
  "constraints":{
    "height_limit_m":80,"green_line_m":30,"buildable_ratio":0.74,
    "briefing":{"text":"本地块限高80m，河道两侧30m绿线，省道保留不可拆。","source":"template"}
  },
  "seed":882314
}
```

`terrain` 必须是完整方阵；`forest`、`river`、`road_inherited` 不可建设。`forest` 不计入玩法 `green_ratio`。

### 2.3 Tile 与放置请求

```json
{"id":"tile_7f3a","type":"res_mid","anchor":[12,7],"cells":[[12,7]],"built_at_year":1,"upkeep":12000}
```

`orientation` 仅桥存在，取 `horizontal` 或 `vertical`：

```json
{"type":"util_bridge","anchor":[20,10],"orientation":"horizontal"}
```

桥必须沿指定方向覆盖连续河道，并同时覆盖两端 `bank`；`cells` 包含两端河岸和中间河道。普通区块不允许携带 `orientation`。

### 2.4 Metrics 与 MetricsDiff

`Metrics` 包含 [01 §4](01-domain.md) 的 14 个指标，以及 `at_year`（briefing/空城可为 0）和 `at_phase`。`MetricsDiff` 的 `delta` 只包含变化字段，`after` 可带完整快照。

```json
{"at_year":0,"at_phase":"briefing","funds":5000000,"population":0,"jobs":0,
 "job_res_ratio":0,"land_price_index":100,"green_ratio":0,"avg_commute":0,
 "congestion":0,"pollution":0,"happiness":50,"tax_income":0,"upkeep":0,
 "coverage_edu":0,"coverage_med":0}
```

### 2.5 Projection、报告与会话恢复

```json
{"year":4,"metrics":{"...":"..."},"events":["拥堵突破阈值"],"source":"template"}
```

`ProjectionYear.events` 是模板事件文字，`source` 固定为 `template`。SSE `ProjectionStep` 也携带同一来源字段。

报告为结构化对象，五维点评字段固定且必须齐全：

```json
{"overview":"总体诊断……","dimensions":{"population":"……","balance":"……","green":"……","traffic":"……","happiness":"……"},"ending_story":"……","source":"template"}
```

`GET /api/sessions/{id}` 除当前 `parcel`、`tiles`、`metrics`、`phase`、`time_left_sec`、`placements_count` 外，还必须返回：`projection`（完整预计算结果，可能为空）、`projection_published_year`、`scores`、`ending`、`report`、`city_name`、`city_name_source`。缺省值分别为 `[]`、`0`、`null`、`null`、`null`、`null`、`null`。`city_name` 与 `city_name_source` 必须同时为空或同时有值。

## 3. REST

### 3.1 创建

`POST /api/sessions`，请求 `{ "seed": 882314 }`，`seed` 可选。响应 201：`session_id`、`parcel`、`phase:"briefing"`、`time_left_sec:20`、`funds`。

### 3.2 查询

`GET /api/sessions/{id}` 返回 §2.5 的完整 `SessionState`，用于刷新、断线和恢复。

### 3.3 放置

`POST /api/sessions/{id}/place`，请求 `{ "type":"res_mid", "anchor":[12,7] }`；桥必须追加 `orientation`。仅 `build`、`polish` 允许。响应为 `tile`、新 `metrics`、`metrics_diff`、`funds_after`。

### 3.4 拆除

`POST /api/sessions/{id}/remove`，请求 `{ "tile_id":"tile_7f3a" }`。仅 `build`、`polish` 允许，返还造价 30%，响应同放置。

### 3.5 跳过简报

`POST /api/sessions/{id}/advance` 只允许 `briefing`，响应 `{ "phase":"build", "time_left_sec":900 }`。其他阶段返回 `invalid_phase`。

### 3.6 锁定

`POST /api/sessions/{id}/finalize` 只允许 `polish`，重复调用返回第一次结果。响应立即包含完整 10 年 `projection`、`ending`、`scores`、结构化 `report`、`city_name` 及 `city_name_source`；计算不依赖 AI。polish 超时由后端自动执行同一流程。

### 3.7 重开

`POST /api/sessions/{id}/restart` 等价于新建会话，可复用原 seed。

## 4. SSE

`GET /api/sessions/{id}/stream` 使用 `text/event-stream`，每条事件带单调 `id`，支持 `Last-Event-ID` 补发；缓冲不足时发送当前快照的 `tick` 与 `phase_change`。

| event | data 必填字段 |
|---|---|
| `tick` | `MetricsDiff` |
| `phase_change` | `phase`、`time_left_sec` |
| `news` | `headline`、`body`、`severity`、`at_year`、`source` |
| `citizen` | `persona`、`text`、`sentiment`、`topic`、`source` |
| `mentor` | `comment`、`theory_refs`、`severity`、`top_issues`（最多 3 条）、`source` |
| `projection_step` | `year`、`metrics`、`events`、`source` |
| `report_ready` | `report`、`city_name`、`source` |
| `error` | `code`、`message` |

`projection_step` 只播放已在 finalize 时算好的 projection；每约 3.5 秒发布一年，第 10 年后发送 `report_ready` 并进入 `report`。AI 事件延迟或失败不得阻塞数值流程，模板事件具有相同契约。

## 5. 阶段规则

| phase | 时长 | 允许操作 |
|---|---:|---|
| `briefing` | 20 秒 | 仅 `advance` |
| `build` | 15 分钟 | 放置、拆除；到时自动进入 `polish` |
| `polish` | 2 分钟 | 放置、拆除、`finalize`；到时自动 finalize |
| `locked` | 约 35 秒 | 仅播放 projection |
| `report` | 不限 | 查看、重开 |

## 6. 版本

当前契约版本为 `v1`。破坏性变更必须升版本并提供迁移说明。
