# 城市模拟沙盘（CITY20）· 仓库 Agent 规范

只写本仓库与设备级规范的差异。Git 纪律、worktree、冲突处理见 `~/.qoder/coder-rules/global-rules.md`。

Collaboration: collaborative
Baseline: main
Default branch: main
Release: Web 演示按 `docs/plan/07-qa-ops.md` 本地启动；macOS / Windows / Android / iOS 四端安装包按 `docs/plan/09-cross-platform.md`（M6 弹性交付，CI artifacts / 本地 Xcode）
Validation: 前端 `cd frontend && npm ci && npm run lint && npm run build`；后端 `cd backend && pip install -e ".[dev]"`（无 pyproject 时 `pip install -r requirements.txt`）后 `ruff check . && pytest -q`。两侧均以存在依赖清单为前提，脚手架未落地时按 CI 的 detect 逻辑跳过；纯文档改动按设备级规范第 5 节的文档例外执行
Worktree: `~/项目/.wt/城市模拟沙盘/<slug>`

## 这是什么

CITY20：AI 驱动的城市规划模拟沙盘，单局硬上限 20 分钟。玩家在程序化生成的地块上完成分区、道路与公共配套规划，确定性 sim 引擎实时推演，AI 三角色（数据大脑 / 市民之声 / 规划导师）以自然语言反馈；终局生成五维诊断报告与 city card。

技术栈：Next.js（App Router）+ TypeScript strict + Canvas 2D；FastAPI + Pydantic v2 + sse-starlette；DeepSeek / Qwen / Kimi / GLM 作为 AI 叙述层。会话状态在内存，无数据库、无账号。

## 唯一执行依据

- `docs/plan/` 是 48 小时开发的唯一执行依据；先读 `docs/plan/00-master.md`，再从 `docs/plan/08-pr-tasks.md` 的任务卡施工。
- 前后端契约以 `docs/plan/02-data-contract.md` 为准：**改契约先改 02 文档，再改代码**。
- 玩法与架构背景见 `docs/game-design.md`、`docs/architecture.md`；实际施工以 `docs/plan/` 为准。

## 铁律

1. **AI 只做叙述层，绝不做数值计算。** 城市指标 100% 由确定性 sim 引擎算出；AI 全挂游戏照跑（模板文案降级）。
2. 前后端只通过 02 契约通信，禁止依赖契约之外的字段或行为。
3. 每张任务卡的「验收标准」就是 DoD，打勾才能合并。
4. 模型选型自由，但业务代码只依赖 OpenAI 兼容抽象，禁止写死 provider。

## 本地开发（脚手架落地后）

- 后端：在 `backend/` 下 `uvicorn app.main:app --reload --port 8000`（目录骨架见 `docs/plan/06-backend.md`）。
- 前端：在 `frontend/` 下 `npm run dev`，用 `API_BASE=http://localhost:8000` 指向本地后端。
- 无任何 LLM key 时必须能完整打完一局（降级链路是验收项，见 `docs/plan/07-qa-ops.md`）。
- 依赖与构建产物（`node_modules`、`.next`、`.venv`、`__pycache__` 等）不进项目卷：放 `$BUILD_SCRATCH_ROOT` 或交给 CI（设备级规范第 5c、8 节）。

## 协作

- 分支用 `feat/xxx`、`fix/xxx`、`chore/xxx`，当天合并当天删；PR 标题遵守 Conventional Commits。
- `main` 受仓库规则集保护：普通协作者需 PR + 1 人审查；IGNGserver 与 HuiHuiya 免审直通（见 `CONTRIBUTING.md`）。**免审直通不等于免 CI。**
- 提交信息与 PR 描述按 `CONTRIBUTING.md`；「测试了什么」一栏不许写「没测」，没时间测就写清风险点。
- 密钥/Token 只进 `.env`（已在 `.gitignore`），仓库只保留 `.env.example`；发现误提交立即报告并轮换。

## 范围边界（不做）

用户账号、持久化数据库、多人协作/对战、真实 OSM 数据、原生界面重写（四端一律 Web 壳复用，见 `docs/plan/09-cross-platform.md`）、音效音乐（PR-17 可选）。详见 `docs/plan/00-master.md`。
