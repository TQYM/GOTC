# CITY20 · 技术架构背景

> 本文是架构导读，不替代专题规划。代码施工以 [`docs/plan/`](plan/README.md) 和对应任务卡为准。

## 总体结构

```text
浏览器（Next.js + TypeScript + Canvas 2D）
  ├── REST：建局、查询、放置、拆除、阶段推进、锁定
  └── SSE：指标 tick、阶段变化、三角色消息、推演步骤、报告
                         │
                         ▼
              FastAPI 编排层（内存会话）
                ├── contracts：Pydantic v2 契约模型
                ├── core：会话、阶段计时、事件缓冲
                ├── sim：世界生成、校验、指标重算、推演、结局
                ├── narrate：AI 角色与模板降级
                └── sse：广播、心跳、Last-Event-ID 补发
```

前后端只通过 [02 · 前后端数据契约](plan/02-data-contract.md) 通信。后端是阶段、合法操作和终局结果的唯一权威；前端刷新时从会话快照恢复，不根据本地猜测推进阶段。

## 依赖边界

- `sim` 是纯确定性数值核心，不依赖 `narrate`。
- `narrate` 只能读取指标和结构化地图摘要，输出契约化文字。
- `api` 负责 HTTP 参数、错误信封和服务调用，不实现数值公式。
- `sse` 负责事件广播和断点补发，不重新计算 projection。
- `llm.py` 是模型供应商的唯一适配边界，业务代码使用 OpenAI 兼容形状。

## 推演与 SSE

`finalize` 先完整预计算十年 projection，并将结果放入会话状态与 REST 响应。`projection_step` 事件只负责按年份播放已计算的切片；断线或刷新可以从 `projection` 和 `projection_published_year` 继续。AI 延迟不会阻塞指标重算、锁定或推演。

## 当前仓库状态

仓库当前处于“规划已冻结、后端 PR-01/02 基础骨架已落地”的阶段：契约模型和确定性地块生成器已有实现，REST、SSE、完整 sim、前端页面和 AI 编排仍按 [08 · PR 任务卡](plan/08-pr-tasks.md) 排队施工。没有配置 LLM key 时，目标链路仍必须通过模板文案完成。

## 相关文档

- 全局决策：[00 · 总体规划](plan/00-master.md)
- 后端模块：[06 · 后端方案](plan/06-backend.md)
- 前端模块：[05 · 前端方案](plan/05-frontend.md)
- 测试与交付：[07 · 测试与交付保障](plan/07-qa-ops.md)
