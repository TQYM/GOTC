# CITY20 

> 一块地、20 分钟、一个 AI 智囊团——你来做市长，建一座经得起规划学检验的城市。

一款 **AI 驱动的城市规划模拟沙盘**：随机生成待开发地块，玩家在 20 分钟硬上限内完成分区、道路与公共配套规划；三套 AI 系统（数据大脑 / 市民之声 / 规划导师）实时推演并回应你的每个决策，终局生成城市规划诊断报告。

本仓库为 **48 小时极限开发** 比赛项目，技术栈：Next.js（前端）· FastAPI（后端）· DeepSeek / Qwen / Kimi / GLM（AI 层）。

## 团队成员

| 成员 | GitHub | 职责 |
|---|---|---|
| TQYM | [@TQYM](https://github.com/TQYM) | 项目负责 / 架构 / 规划文档 |
| IGNG | [@IGNGserver](https://github.com/IGNGserver) | **后端全部**：sim 引擎 / AI 编排 / SSE / 契约模型 |
| 灰灰 | [@HuiHuiya](https://github.com/HuiHuiya) | **前端全部**：Canvas 沙盘 / 拖拽交互 / 信息流 / 报告页 |

## 仓库结构

```
.
├── frontend/           # Next.js 前端（Canvas 沙盘 + 三栏信息流）
├── backend/            # FastAPI 后端（模拟引擎 + AI 编排 + SSE）
├── docs/
│   ├── plan/           # ⭐ 48h 执行规划（唯一执行依据，从 08 任务卡入手）
│   ├── game-design.md  # 玩法设计：20 分钟循环
│   └── architecture.md # 技术架构与 AI 模型分工
├── scripts/            # 开发辅助脚本
└── .github/            # CI 与 Issue / PR 模板
```

## 快速开始

> 脚手架开发中，将在首个功能迭代补齐。详见 [docs/architecture.md](docs/architecture.md)。

## 协作规范

提交与分支规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。`main` 分支受保护：普通变更需 PR + 1 人审查；**IGNGserver 与 HuiHuiya 免审直通**（已配置仓库规则集）。

## 许可证

[Apache License 2.0](LICENSE)
