# CITY20

> 真实北京、不限时、一个 AI 智囊团——你是城市管理者，让熟悉的街区在你手里生长。

一款 **AI 驱动的城市更新模拟沙盘**：以**真实北京片区**（OpenStreetMap 数据离线栅格化，首发朝阳 CBD–通惠河）为舞台的真 3D 游戏——城市管理者在真实路网、水系与既有建筑之间做更新决策；确定性 sim 引擎负责推演，三套 AI 系统（数据大脑 / 市民之声 / 规划导师）只负责解读与叙述。游戏不限现实时间，可随时快进一年、只读推演未来或生成当前时点的城市体检报告，并支持多端同步同一存档（见 [docs/plan/10-persistence-sync.md](docs/plan/10-persistence-sync.md)）。

本仓库为 **48 小时极限开发** 比赛项目，技术栈：Next.js + Three.js（前端**卡通风格**真 3D，见 [docs/plan/11-real-beijing-3d.md](docs/plan/11-real-beijing-3d.md)）· FastAPI + SQLite 事件溯源存档（后端，SQLite 是唯一事实源）· DeepSeek / Qwen / Kimi / GLM（AI 叙述层）· Tauri / Capacitor（macOS / Windows / Android / iOS 四端壳，见 [docs/plan/09-cross-platform.md](docs/plan/09-cross-platform.md)）。

## 团队成员

| 成员 | GitHub | 职责 |
|---|---|---|
| TQYM | [@TQYM](https://github.com/TQYM) | 项目负责 / 架构 / 规划文档 |
| IGNG | [@IGNGserver](https://github.com/IGNGserver) | **后端全部**：sim 引擎 / AI 编排 / SSE / 契约模型 |
| 灰灰 | [@huihiya](https://github.com/huihiya) | **前端全部**：3D 沙盘 / 拖拽交互 / 信息流 / 报告页 |

## 仓库结构

```
.
├── frontend/           # Next.js + Three.js 前端（真实北京 3D 沙盘 + 三栏信息流）
├── backend/            # FastAPI 后端（模拟引擎 + AI 编排 + SSE + SQLite 事件溯源）
├── docs/
│   ├── plan/           # ⭐ 48h 执行规划（唯一执行依据，从 08 任务卡入手）
│   ├── game-design.md  # 玩法背景与城市管理者循环（导读）
│   └── architecture.md # 技术架构背景（导读）
├── scripts/            # 开发辅助脚本
└── .github/            # CI 与 Issue / PR 模板
```

## 当前实施基线

现有确定性 sim 与 AI 模板降级能力继续复用，后续施工和联调统一采用以下 saves v2 规则；各 PR 是否完成以实际合并与验收记录为准，不把规划条目视为已完成能力：

- 默认加载真实北京「朝阳 CBD–通惠河」数据包，保留 seed 驱动的自定义沙盒；支持 place/remove/redevelop，以及写回存档的 `advance` 年度结算；
- `POST /api/saves` 创建长期存档，8 位城市码用于加入和跨端协作；SQLite 事件溯源保存 ops、快照与报告，内存只作热点缓存和 SSE 扇出；
- `project` 是基于当前快照的只读预览，不写库、不推进年份；`report` 反映当前报告时点，可重复生成并继续经营，不是终局；
- 数据大脑保留阈值判断和 8 秒节流，市民之声保留人设/主题路由；规划导师在每 10 个已提交领域 op 后自动点评，也可由城市管理者主动请教；所有角色均有模板降级；
- SSE 使用 `snapshot/op_applied/city_year` 等 02 契约事件、15 秒 comment 心跳与 Last-Event-ID 恢复，不发送倒计时事件。

`docs/plan/` 是唯一执行依据，API 字段、端点和事件以 [02 · 前后端数据契约](docs/plan/02-data-contract.md) 为准。

数值平衡的前置修正、参数扫描和五种策略验收标准见 [12 · 数值平衡执行方案](docs/plan/12-balance-plan.md)。**样本局尚未完成，候选参数不得直接写入生产配置，也不能据此宣称 PR-18 已完成。**

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

后端使用**单 uvicorn worker**；默认数据库为 `data/city20.db`，进程重启后按城市码恢复存档。默认不配置 LLM key 也可以走通建城、建设、年度推进、推演和报告全流程，AI 输出会自动使用规则模板。需要启用真实模型时，参考 `.env.example` 在启动服务前设置 `CITY20_*` 环境变量；支持 DeepSeek、Qwen、Kimi、GLM，以及其他 OpenAI 兼容端点。

### API 联调

创建默认真实北京存档：

```bash
curl -X POST http://127.0.0.1:8000/api/saves \
  -H 'content-type: application/json' \
  -d '{"name": "我的城市", "parcel_id": "beijing_cbd"}'
```

自定义沙盒可改为 `{"name":"沙盒城市","parcel_id":"sandbox","seed":42}`。创建后先从 briefing 调用 `start` 进入 building；place/remove/redevelop/advance 请求必须携带 02 规定的 `client_op_id/base_seq`。

主要端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/saves` | 创建存档，可选 `seed/name/parcel_id` |
| `GET` | `/api/saves/{city_code}` | 获取完整 SaveState，刷新与断线兜底 |
| `POST` | `/api/saves/{city_code}/start` | briefing → building，重复调用返回当前状态 |
| `POST` | `/api/saves/{city_code}/place` | 放置区块并返回完整 OperationResult |
| `POST` | `/api/saves/{city_code}/remove` | 拆除城市管理者区块并返回 OperationResult |
| `POST` | `/api/saves/{city_code}/redevelop` | 更新改造既有资产并返回拆迁明细 |
| `POST` | `/api/saves/{city_code}/advance` | 年度结算并写回，`city_year` +1 |
| `POST` | `/api/saves/{city_code}/project` | 只读推演 1–20 年（默认 10），不写回 |
| `POST` | `/api/saves/{city_code}/report` | 生成当前时点的城市体检报告 |
| `GET` | `/api/saves/{city_code}/reports` | 获取最近 20 份报告，新到旧 |
| `POST` | `/api/saves/{city_code}/mentor` | 主动请教规划导师，结果经 SSE 推送 |
| `GET` | `/api/saves/{city_code}/events` | saves v2 SSE，支持 Last-Event-ID |

重开意味着创建新存档；旧 `/api/sessions`、`finalize`、`restart` 和倒计时字段均不属于 saves v2。请求、响应、SSE 字段及错误码以 [02 · 前后端数据契约](docs/plan/02-data-contract.md) 为准。

### 启动前端

```bash
cd frontend
npm ci
npm run dev
```

前端默认请求 `http://localhost:8000`，可在 `frontend/.env.local` 设置 `NEXT_PUBLIC_API_BASE`。生产使用 `npm run build && npm run start`。单 worker、无 key 演示、SQLite 在线备份与恢复步骤见 [运行与存档运维](docs/operations.md)。

### 代码质量

在 `frontend/` 中运行 `npm test && npm run lint && npm run build`；在 `backend/` 中运行：

```bash
ruff check .
pytest -q
```

玩法背景见 [docs/game-design.md](docs/game-design.md)，架构导读见 [docs/architecture.md](docs/architecture.md)。

## 协作规范

提交与分支规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。`main` 分支受保护：普通变更需 PR + 1 人审查；**IGNGserver 与 huihiya 免审直通**（已配置仓库规则集）。

## 许可证

[Apache License 2.0](LICENSE)
