# CITY20 · 技术架构背景

> 本文是架构导读，不替代专题规划。代码施工以 [`docs/plan/`](plan/README.md) 和对应任务卡为准。

## 总体结构

```text
浏览器（Next.js + TypeScript + Three.js / React Three Fiber）
  ├── REST：saves v2 创建/加入、start、领域 op、advance、project、report、mentor
  └── SSE：snapshot、op_applied、city_year、phase_change、三角色消息、report_ready
                         │
                         ▼
              FastAPI 单 worker 编排层
                ├── contracts：Pydantic v2 saves v2 契约模型
                ├── core：SaveService、CityState、per-save 锁、事件缓冲
                ├── repository：SQLite WAL / saves / ops / snapshots / reports
                ├── sim：确定性地块、校验、指标重算、年度步进、只读推演
                └── narrate：AI 三角色与模板降级
                         │
                         ▼
              SQLite 唯一事实源 + 本地 OSM 数据包
```

前后端只通过 [02 · 前后端数据契约](plan/02-data-contract.md) 通信。后端是阶段、合法操作、op seq 和数值结果的唯一权威；前端刷新或序号缺口时从完整 SaveState 恢复，不根据本地猜测推进城市。SQLite 是唯一事实源，内存只保存热点状态和 SSE 扇出。

## 依赖边界

- `sim` 是纯确定性数值核心，不依赖 `narrate`；既有资产是独立的模拟输入，不是玩家 tile。
- `narrate` 只能读取指标和结构化地图摘要，输出契约化文字，不计算分数、不阻塞领域提交。
- `api` 负责 HTTP 参数、错误信封和服务调用，不实现数值公式。
- 每次写操作在副本上执行，事务提交后替换热状态并广播；`(save_id, client_op_id)` 唯一约束保证重试返回首次结果。
- SSE event id 与 op seq 分离；提交先于广播，15 秒 comment 心跳不推进年份。
- GIS 下载只属于开发期工具，运行时从本地 `data/parcels` 读取，不请求在线地图或瓦片。

## 年度、推演与报告

`advance` 调用共享年度步进并写回存档，`city_year + 1`。`project` 在指定 base_seq 的副本上计算 1–20 年，不写数据库；播放速度只属于浏览器。`report` 是当前时点、可重复的城市体检，保存最近 20 份；AI 可稍后以同一 report_id 更新叙述，但五维分数、标签和真实城市不变。关闭推演或报告后继续经营，另一端也不被阻塞。

## 当前实现与验收边界

当前 worktree 已落地 saves v2、真实北京 GIS 管线与数据、redevelop、React/Three.js 前端和 SQLite 在线备份。自动化测试与构建结果以当次验证记录为准；真机帧率、触屏手感、实体双端同步、离线游玩和地标视觉辨识度仍需按 [07 · 测试与交付保障](plan/07-qa-ops.md) 人工验收，不能由单元测试代替。

## 相关文档

- 全局决策：[00 · 总体规划](plan/00-master.md)
- 后端模块：[06 · 后端方案](plan/06-backend.md)
- 前端模块：[05 · 前端方案](plan/05-frontend.md)
- 测试与交付：[07 · 测试与交付保障](plan/07-qa-ops.md)
- 运行、备份与恢复：[运行与存档运维](operations.md)
