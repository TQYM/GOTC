# CITY20

> 真实北京、不限时、一个 AI 智囊团——你是城市管理者，让熟悉的街区在你手里生长。

一款 **AI 驱动的城市规划模拟沙盘**：以**真实北京片区**（OpenStreetMap 数据离线栅格化）为舞台的真 3D 城市更新游戏——玩家作为城市管理者，在真实路网、水系与既有建筑之间做更新决策；三套 AI 系统（数据大脑 / 市民之声 / 规划导师）实时推演并回应你的每个决策，随时生成城市规划诊断报告。支持多端同步同一存档（见 [docs/plan/10-persistence-sync.md](docs/plan/10-persistence-sync.md)）。

本仓库为 **48 小时极限开发** 比赛项目，技术栈：Next.js + Three.js（前端**卡通风格**真 3D，见 [docs/plan/11-real-beijing-3d.md](docs/plan/11-real-beijing-3d.md)）· FastAPI（后端）· DeepSeek / Qwen / Kimi / GLM（AI 层）· Tauri / Capacitor（macOS / Windows / Android / iOS 四端壳，见 [docs/plan/09-cross-platform.md](docs/plan/09-cross-platform.md)）。

## 团队成员

| 成员 | GitHub | 职责 |
|---|---|---|
| TQYM | [@TQYM](https://github.com/TQYM) | 项目负责 / 架构 / 规划文档 |
| IGNG | [@IGNGserver](https://github.com/IGNGserver) | **后端全部**：sim 引擎 / AI 编排 / SSE / 契约模型 |
| 灰灰 | [@HuiHuiya](https://github.com/HuiHuiya) | **前端全部**：3D 沙盘 / 拖拽交互 / 信息流 / 报告页 |

## 仓库结构

```
.
├── frontend/           # Next.js + Three.js 前端（真实北京 3D 沙盘 + 三栏信息流）
├── backend/            # FastAPI 后端（模拟引擎 + AI 编排 + SSE）
├── docs/
│   ├── plan/           # ⭐ 48h 执行规划（唯一执行依据，从 08 任务卡入手）
│   ├── game-design.md  # 玩法背景与玩家循环（导读）
│   └── architecture.md # 技术架构背景（导读）
├── scripts/            # 开发辅助脚本
└── .github/            # CI 与 Issue / PR 模板
```

## 当前状态

后端 M1～M3 的核心能力已经落地：

- 确定性地块生成、放置校验、人口/地价/财政/交通/污染/幸福度/覆盖率重算，以及 10 年推演；
- `/api/sessions` 会话 REST 接口，支持创建、查询、放置、拆除、推进阶段、结算和重开；
- OpenAI 兼容的 AI 叙述抽象与三角色编排：数据大脑支持阈值判断和 8 秒节流合并，市民之声支持人设/主题路由，规划导师支持 90 秒点评、polish Top3 和结构化终局报告；全部角色均有模板降级；
- 健康检查与统一错误信封已经接入。

前端页面、三角色信息流 UI 和生产级 SSE 网关仍按 [PR 任务卡](docs/plan/08-pr-tasks.md) 推进。当前 SSE 路由提供联调桩流，尚未接入环形缓冲、心跳和断点补发。`docs/plan/` 是唯一执行依据。

最近的规划与契约对齐见提交 [`ea77888`](https://github.com/TQYM/GOTC/commit/ea77888)。

## 快速开始

### 启动后端

```bash
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/healthz
```

默认不配置 LLM key 也可以完成一局，AI 输出会自动使用规则模板。需要启用真实模型时，参考 `.env.example` 在启动服务前设置 `CITY20_*` 环境变量；支持 DeepSeek、Qwen、Kimi、GLM，以及其他 OpenAI 兼容端点。

### API 联调

创建一局并固定随机种子：

```bash
curl -X POST http://127.0.0.1:8000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"seed": 42}'
```

主要端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/sessions` | 创建会话，可选 `seed` |
| `GET` | `/api/sessions/{session_id}` | 获取地块、已放置区块和实时指标 |
| `POST` | `/api/sessions/{session_id}/place` | 放置区块并返回指标差值 |
| `POST` | `/api/sessions/{session_id}/remove` | 拆除区块并返回退款与指标差值 |
| `POST` | `/api/sessions/{session_id}/advance` | 推进 briefing/build/polish 阶段 |
| `POST` | `/api/sessions/{session_id}/finalize` | 锁定城市并返回推演、结局和报告 |
| `POST` | `/api/sessions/{session_id}/restart` | 按新 seed 重开一局 |
| `GET` | `/api/sessions/{session_id}/stream` | SSE 联调流（当前为桩流） |

请求和响应字段以 [02 · 前后端数据契约](docs/plan/02-data-contract.md) 为准。

### 代码质量

在 `backend/` 中运行：

```bash
ruff check .
pytest -q
```

玩法背景见 [docs/game-design.md](docs/game-design.md)，架构导读见 [docs/architecture.md](docs/architecture.md)。

## 协作规范

提交与分支规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。`main` 分支受保护：普通变更需 PR + 1 人审查；**IGNGserver 与 HuiHuiya 免审直通**（已配置仓库规则集）。

## 许可证

[Apache License 2.0](LICENSE)
