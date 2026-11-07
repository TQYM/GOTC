# CITY20 项目规划（Plan）

> 本目录是 48 小时开发的**唯一执行依据**。每张 PR 任务卡（[08-pr-tasks.md](08-pr-tasks.md)）引用对应专题文档的章节，提交者按卡施工即可，不需要额外决策。

## 阅读顺序

| 文档 | 内容 | 谁必读 |
|---|---|---|
| [00-master.md](00-master.md) | 目标、范围、里程碑、PR 路线图、全局决策 | 所有人（先读） |
| [01-domain.md](01-domain.md) | 领域模型：格子、区块、指标、阶段 | 前后端所有人 |
| [02-data-contract.md](02-data-contract.md) | JSON Schema、REST 端点、SSE 事件协议 | 前后端所有人 |
| [03-sim-engine.md](03-sim-engine.md) | 模拟引擎数值模型：公式、参数表、平衡目标 | sim/后端 |
| [04-ai-roles.md](04-ai-roles.md) | AI 三角色契约、Prompt 骨架、人设卡、降级策略 | AI/后端 |
| [05-frontend.md](05-frontend.md) | 前端规格：路由、组件树、状态、渲染、视觉 | 前端 |
| [06-backend.md](06-backend.md) | 后端规格：模块、目录、依赖、配置 | 后端 |
| [07-qa-ops.md](07-qa-ops.md) | 测试策略、CI、本地联调、环境变量 | 所有人 |
| [08-pr-tasks.md](08-pr-tasks.md) | **22 张 PR 任务卡**，按依赖排序 | 所有人 |
| [09-cross-platform.md](09-cross-platform.md) | 四端适配：Capacitor / Tauri 壳、触屏交互、打包分发 | 前端 |
| [10-persistence-sync.md](10-persistence-sync.md) | 不限时 / SQLite 存档 / 多端同步 / 玩家=城市管理者 | 后端为主 |
| [11-real-beijing-3d.md](11-real-beijing-3d.md) | **真实北京 GIS 数据 + 真 3D 渲染**（最新重大变更，优先读） | 前后端所有人 |
| [12-balance-plan.md](12-balance-plan.md) | 数值平衡：前置规则、参数扫描、策略样本与验收门槛 | sim/后端/交付 |

## 铁律（所有 PR 必须遵守）

1. **AI 只做叙述层，绝不做数值计算。** 城市指标 100% 由确定性 sim 引擎算出（[03](03-sim-engine.md)），AI 只负责把数值变化"翻译"成人话（[04](04-ai-roles.md)）。AI 全挂游戏照跑。
2. **前后端只通过 [02](02-data-contract.md) 的契约通信。** 任何契约变更必须先改 02 文档再改代码。
3. **每张任务卡的"验收标准"就是 DoD**，打勾才能合并。
4. **模型选型是每个 PR 提交者的自由**（04 只定角色与接口），但接口必须保持 OpenAI 兼容抽象，禁止在业务代码里写死 provider。
