# 00 · 总体规划

## 项目定义

**CITY20**：AI 驱动的城市更新模拟沙盘，**不限时**。城市管理者在真实北京片区（GIS 数据，首发朝阳 CBD–通惠河）上以卡通风格真 3D 场景做城市更新决策，确定性模拟引擎实时推演城市运行，AI 三角色（数据大脑 / 市民之声 / 规划导师）以自然语言反馈每个决策；随时可只读推演未来、生成反映当前时点的五维城市体检报告与可分享 city card。SQLite 事件溯源存档支持多端同步，见 [10](10-persistence-sync.md)。

## 范围边界

**做（IN）**
- 真实北京片区（GIS 数据离线栅格化，见 [11](11-real-beijing-3d.md)）+ 程序化沙盒模式
- 真 3D 渲染（Three.js + React Three Fiber，既有建筑 + 城市管理者区块同场景，见 [11](11-real-beijing-3d.md)）
- 7 大类 14 种可放置区块（见 [01](01-domain.md)）
- 确定性模拟引擎：人口、地价、交通（BPR）、污染、财政、幸福度
- AI 叙述层：三种角色的流式文本反馈
- 不限时经营：城市管理者主动 `advance` 推进年份，`project` 只读预览，`report` 随时诊断；持久化 phase 只有 briefing/building，projecting/report 是各端本地 UI 态（见 [10](10-persistence-sync.md)）
- SQLite 事件溯源：ops + 每 50 op 快照 + 增量重放，数据库为唯一事实源；8 位城市码分享与多端同步同一存档
- 五维评分 + 雷达图 + 可重复生成的当前城市体检报告 + city card 分享图
- 含隐藏标签的城市体检标签判定（沿用 `ending` 字段，不代表终局）
- 四端交付（macOS / Windows / Android / iOS）：Web 代码复用 + Tauri / Capacitor 壳（见 [09](09-cross-platform.md)，里程碑 M6）

**不做（OUT）**
- 用户账号（知道城市码即可共同经营）/ 外部数据库服务
- 多人对战 / 离线编辑（同存档在线协作属于 IN）
- 在线地理信息服务（OSM 数据全部离线预处理打包进仓库，见 [11](11-real-beijing-3d.md)）
- 原生界面重写（四端一律 Web 壳复用，见 [09](09-cross-platform.md)）
- 音效音乐（PR-17 为可选增强，赛事时间不够直接砍）

## 核心设计哲学

1. **模拟与叙述分层。** 数值世界（sim 引擎）是骨架，AI 世界（叙述层）是血肉。骨架必须脱离血肉独立成立——AI 供应商挂了、超时了、乱说了，游戏数值依然正确、流程依然完整。可由 AI 生成的文本都携带 `source: "ai" | "template"`，前端能区分真实生成与模板降级。
2. **每个格子都有规划学意义。** 所有数值参数对标真实规范（GB50180-2018 生活圈体系、BPR 交通模型），规划导师的点评引用真实理论条目（理论库见 [04](04-ai-roles.md) 附录）。
3. **不限时，节奏由城市管理者掌控（m00594 决策）。** 取消一切现实倒计时；游戏内年份 `city_year` 取代倒计时成为进度轴，城市管理者主动快进年份、随时只读推演（默认 10 年）、随时生成当前报告（机制详见 [10](10-persistence-sync.md)）。

## 技术栈总览（版本经联网核查，2026-11）

| 层 | 选型 | 版本要求 | 核查结论 |
|---|---|---|---|
| 前端框架 | Next.js（App Router） | ≥15，推荐 16 | 16.3 已受 Vercel 官方支持 |
| UI 基础 | React + TypeScript strict | — | — |
| 拖拽 | @dnd-kit/core | ≥6 | 当前主流方案 |
| 渲染 | Three.js + React Three Fiber（真 3D，**卡通风格**） | — | 真实北京 GIS 场景 + toon 渲染，见 [11](11-real-beijing-3d.md) |
| 图表 | 手写 SVG（雷达图/折线） | — | 不引库，像素级可控 |
| 后端 | FastAPI + Pydantic v2 | — | 单 uvicorn worker |
| 持久化 | SQLite（WAL）+ aiosqlite | — | 事件溯源，ops/snapshots/reports；数据库为唯一事实源 |
| SSE | sse-starlette | ≥2 | 事实标准；内存仅作事件缓冲与扇出 |
| LLM 接入 | OpenAI 兼容客户端抽象 | — | 国产模型几乎全员兼容 |
| 代码质量 | Ruff（py）/ ESLint+Prettier（ts） | — | CI 强制 |
| 测试 | pytest + Vitest | — | 见 [07](07-qa-ops.md) |

## 全局架构

```
浏览器 / 四端 Web 壳 (Next.js)
  ├── Three.js 真实北京沙盘 ───┐
  ├── 建设面板 / 指标条          │  REST: saves v2
  ├── 三栏信息流 (SSE) ────────┤  SSE:   事件流 + 全量恢复
  └── 推演 / 当前体检报告        │
                              ▼
                    FastAPI 编排层（单 worker）
                      ├── saves API + per-save 锁
                      ├── SQLite 事件溯源（ops / snapshots / reports，唯一事实源）
                      ├── Sim 引擎（纯函数，确定性）
                      ├── SSE 广播（内存仅作缓冲与扇出）
                      └── AI 编排层（OpenAI 兼容，可插拔 provider）
```

**数据流向**（领域写操作）：
`城市管理者操作 → REST → per-save 串行校验 → Sim 重算 → op + 存档状态 + 可选快照同事务提交 → SSE op_applied/city_year 推各端 → 触发器判断 → AI 异步调用 → SSE news/citizen/mentor`。

`project` 在快照副本上只读运行，不写 ops/saves/snapshots/reports；`report` 写报告历史但不增加领域 op seq。刷新、换端、断线兜底统一 `GET /api/saves/{city_code}`。

## 里程碑

| 里程碑 | 内容 | 达成标准 | 截止时间 |
|---|---|---|---|
| **M1 骨架** | PR-01~05 合并 | 能打开页面、看到真实北京或沙盒地块、拖区块上去、非法位置有红框提示 | D1 13:00 |
| **M2 心脏** | PR-06~08 合并 | 放置后顶部指标条实时变化；拆造有代价 | D1 18:00 |
| **M3 灵魂** | PR-09~13 合并 | 三栏信息流开始流式说话；拔掉 API key 游戏照跑 | D1 24:00 |
| **M4 血肉** | PR-14~16 合并 | 走通建城→建设→只读推演→当前报告→继续经营，出报告和雷达图 | D2 15:00 |
| **M5 交付** | PR-17~18 合并 | 五种策略 × 5 seed 平衡记录 + demo 视频 + README 演示截图；样本未完成前不得视为达成 | D2 22:00 |
| **M6 四端** | PR-19~22 合并 | Android APK + macOS/Windows 包可走通完整经营流程并跨端续玩；iOS 按 [09 §6.4](09-cross-platform.md) 三路径交付 | M5 后弹性窗口 |
| **M7 存档与真实北京** | PR-23~29 合并 | SQLite 重放一致、存档跨端同步、真实北京数据包与 redevelop 全流程通过验收 | 穿插执行 |

## PR 路线图（依赖图）

```
PR-01 骨架 ──┬── PR-02 地块生成 ──┬── PR-03 API骨架 ──┬── PR-04 3D场景
             │                    │                   └── PR-05 拖拽
             │                    └── PR-06 人口地价 ──┬── PR-07 交通
             │                                        └── PR-08 污染幸福度
             └── PR-09 LLM抽象 ──┬── PR-10 数据大脑
                                 ├── PR-11 市民之声 ── PR-13 SSE网关
                                 └── PR-12 规划导师 ──┘
PR-14 信息流UI ← PR-04+PR-13
PR-15 状态机 ← PR-03+PR-06
PR-16 报告 ← PR-08+PR-12+PR-14
PR-17 打磨（可选） ← PR-16
PR-18 平衡交付 ← PR-16
PR-19 触屏适配+静态导出 ← PR-16
PR-20 Android 壳 ← PR-19
PR-21 macOS+Windows 壳 ← PR-19
PR-22 iOS 壳（条件性） ← PR-19
PR-23~26 不限时/存档/多端同步 ← 见 [10](10-persistence-sync.md)
PR-27 北京数据管线 ← PR-01（纯数据活，与 M1 并行）
PR-28 既有建筑3D层 ← PR-04+PR-27
PR-29 真实片区加载+redevelop ← PR-27+PR-06
```

并行建议：三人分工时，**前端线（04/05/14）**、**sim 线（02/06/07/08）**、**AI 线（09/10/11/12/13）** 三条线在 PR-01 之后完全独立，只在 PR-15/16 汇合。

## 风险登记册

| 风险 | 概率 | 预案 |
|---|---|---|
| LLM 流式延迟拖垮节奏感 | 中 | AI 输出全部异步 + 前端打字机效果兜底；领域 op 提交、年度推进和 SSE 广播不依赖 AI（M3 验收标准已强制） |
| 数值平衡崩了（分数全 0 或全 100） | 高 | PR-18 预留 3h 专职调参；参数集中在 `backend/sim-config.yaml`，由 `app/config.py` 加载；样本局未完成前不写生产候选值 |
| SQLite 写入冲突或存档无法恢复 | 中 | 单 worker + per-save 锁 + WAL；op/状态/快照同事务，验收 200 ops 重放与进程重启恢复，并提供在线安全备份 |
| 3D 拾取手感差 / 移动端掉帧 | 中 | PR-05 验收含"10 次连续放置无一次误触"；帧率预算与砍单见 [11 §6.4/§9](11-real-beijing-3d.md) |
| GIS 数据质量（高度缺失/覆盖不全） | 高 | 默认层高表 + 地标手工标注 + 离线打包，见 [11 §3/§6.3](11-real-beijing-3d.md) |
| SSE 在代理/防火墙下断流 | 低 | 前端 EventSource 自动重连 + 后端支持 Last-Event-ID 续传（PR-13） |
| 时间不够 | 中 | 砍单顺序：M6 四端（按 [09 §8](09-cross-platform.md) 优先级，先 iOS 后桌面保 Android）→ PR-17 打磨 → 报告历史 → 环境事件池；SQLite 存档与同步不可砍 |
