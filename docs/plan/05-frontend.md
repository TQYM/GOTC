# 05 · 前端方案（Next.js 全栈客户端）

> 前端开发者按本文档施工。唯一接口是 [02 契约](02-data-contract.md)；后端可能随时从桩切到真身，**前端不许依赖任何契约之外的字段或行为**。
> ⚠️ **渲染层重大变更**：Canvas 2D 伪 2.5D 作废，改为 **Three.js 真 3D + 真实北京 GIS 场景（卡通风格）**，全部渲染细则以 [11-real-beijing-3d.md](11-real-beijing-3d.md) 为准。
> ⚠️ **限时机制废弃（m00594）**：无倒计时、无 build/polish 限时阶段，不限时状态机以 [10](10-persistence-sync.md) 与本文 §2.4 为准；§3.4 倒计时已移除。

## 1. 技术选型（已定，不再纠结）

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js ≥15（推荐 16，App Router） | 官方支持现行；SSR 对首页 SEO/首屏无要求，但开发体验与生态最强 |
| 语言 | TypeScript 严格模式 | 契约字段多，靠类型防手滑 |
| 样式 | Tailwind CSS + CSS 变量主题 | 沙盘 UI 大量内联几何计算，utility 类最顺手 |
| 客户端状态 | Zustand | 会话状态一个 store 装下，配合 Immer 做不可变更新 |
| 服务端状态 | 手写 fetch 封装 + SSE 管理器 | 数据形状由契约死锁，RTK Query/React Query 的收益撑不起学习成本；SSE 本来就要自己管重连 |
| 拖拽 | @dnd-kit/core | 现行主流、无障碍好，支持工具栏到 Canvas 的多格预览 |
| 图表 | 自绘 SVG（雷达图/曲线） | 报告页图表就三种，引库反而受制 |
| 地图渲染 | **Three.js + @react-three/fiber + drei**（真 3D） | 真实北京场景：既有建筑拉伸 + 玩家区块 instanced，细则 [11 §6](11-real-beijing-3d.md) |
| 部署 | 同仓库 `frontend/` 目录，`npm run build` 出静态 + Node 运行时 | 比赛现场一条命令起服务 |

## 2. 页面与组件树

三个路由：`/`（落地页 + 开局面板）、`/game/[sessionId]`（主游戏）、`/report/[sessionId]`（报告页，可分享链接）。

### 2.1 落地页 `/`

- 标题「CITY20 · 二十分钟市长计划」+ 一句话卖点（AI 规划师陪你造一座城）。
- 「新开一局」按钮 → `POST /api/sessions` → 跳 `/game/{id}`。
- 「输入种子复现」输入框（可选，演示/调试用）。
- 玩法说明：真实北京片区自由更新，不限时；随时快进年份、随时推演未来、随时生成体检报告。

### 2.2 游戏页 `/game/[sessionId]` 布局（三栏）

```
┌──────────────┬──────────────────────────┬─────────────┐
│ 左：指标面板  │ 中：Canvas 沙盘           │ 右：AI 信息流 │
│ 资金/人口/   │ 48×48 网格 + 地形 + 区块  │ news/citizen│
│ 通勤/拥堵/   │ 顶部：阶段横幅+城市年份    │ /mentor     │
│ 幸福度/绿地  │ 底部：建造工具栏           │ 滚动自动置底 │
└──────────────┴──────────────────────────┴─────────────┘
```

### 2.3 组件清单（每个组件一句话职责）

| 组件 | 职责 | 关键点 |
|---|---|---|
| CityScene3D | 3D 场景：地形/既有建筑/玩家区块/悬停高亮/非法格红显 | 按 [11 §6](11-real-beijing-3d.md) 分层；Raycaster 拾取换算 r,c；OrbitControls 相机 |
| ToolBar | 14 种区块的卡牌列表，拖拽源 | 卡片显示造价/占地；资金不足自动置灰（按本地缓存的 funds，真值等后端） |
| PlacementLayer | 拖拽悬停时的覆盖格预览 | 合法绿框/非法红框；多格区块按 anchor+形状展开 |
| MetricsPanel | 14 指标仪表盘 | 数值变化时用 300ms 颜色脉冲（升绿降红）提示 delta |
| PhaseBanner | 阶段名 + 城市年份 `city_year` + 推演/报告入口 | 年份只信后端事件与响应，无倒计时；提供「快进一年」「推演 10 年」「生成报告」按钮 |
| InfoFeed | SSE 三栏信息流 | 按事件类型分组渲染样式；自动滚动到底，用户上翻阅读时暂停自动滚 |
| ProjectionPlayer | 推演期年度快进动画 | 消费后端已完整预计算的 `projection_step` 逐帧推进（约 3.5s/年）；断线或刷新时用会话中的完整 `projection` 按 `projection_published_year` 确定性补帧 |
| ReportPage | 五维雷达 + 评分 + 结局 + 报告全文 + 分享 | 雷达图自绘 SVG；结局徽章按 ending 值映射插画 |
| BuildingDetailPage | 学校/医院等特殊建筑专属页（右侧滑出，移动端全屏） | 服务概览/满意度/历史曲线/覆盖高亮/扩建，规格见 [13 §3](13-refined-art-and-interaction.md) |
| InfoViewBar | 五类信息视图覆盖层（绿地/污染/交通/教育/医疗） | 与专属页联动，见 [13 §4.2](13-refined-art-and-interaction.md) |
| LabelLayer | 真实地名 Billboard 标注（中文优先、LOD 分级） | labels.json 驱动，见 [13 §2](13-refined-art-and-interaction.md) |

### 2.4 状态机（前端唯一的状态真相）

Zustand store 字段与迁移：

| 状态 | 进入条件 | 出口 |
|---|---|---|
| loading | 路由进入 | GET 存档成功 → 对应当前 phase；404 → 回首页 |
| briefing | phase=briefing | 用户点「开始建设」→ building（后端确认为准） |
| building | phase=building | 用户点「推演 10 年」→ projecting；点「生成报告」→ report；`advance` 快进一年留在 building |
| projecting | phase=projecting | 后端已计算完整 projection；前端播放 `projection_step`；播完玩家自选回 building 或转 report（预览不写回） |
| report | phase=report | 返回 building 继续建设（不限时，随时再生成）；报告提供 scores、ending、结构化 report、city_name |

**规则：一切状态迁移以 REST 响应或 phase_change 事件为准；本地只许做「乐观显示」（如拖拽悬停），不许做「乐观迁移」。**

## 3. 关键交互设计

### 3.1 拖拽放置

- 从 ToolBar 拖出区块卡牌（@dnd-kit），悬停沙盘时 PlacementLayer 展开覆盖格预览，实时合法性用**本地预校验**（地形表 + 已占用格缓存 + 资金缓存），非法即红框禁止落下。
- 落下时调用 place 端点：成功 → 棋盘落子 + 指标脉冲；失败 → 按错误协议弹对应 toast，**本地状态零变更**。
- 本地预校验只是体验层：最终以 REST 错误协议为准（比如阶段不合法、并发占用）。

### 3.2 拆除

- 进入「拆除模式」点选已放置区块；二次确认弹层显示返还金额；确认后调 remove，棋盘动画消失。

### 3.3 断线恢复

- 页面刷新/切后台：路由重进时 GET 会话全量恢复（棋盘 + 指标 + 阶段 + projection + 已发布年份 + scores/ending/report/city_name）。
- SSE 断开：InfoFeed 顶部显示红色「连接中断，重连中…」；前端每 2s 重连一次，带 Last-Event-ID；恢复后自动隐藏。重连超过 30s 提示用户刷新。
- 操作请求失败（网络层）：toast + 一键重试；不做自动重试（防重复扣款语义，幂等性问题见 06 §6）。

### 3.4 城市年份（无倒计时）

- `city_year` 来自 REST 响应与 SSE 事件（advance 后 +1），前端只展示不推算；多端同步时以 `op_applied` 事件刷新（见 [10](10-persistence-sync.md)）。
- 全项目不存在倒计时组件与 `time_left_sec` 消费方。

## 4. 视觉与动效基调

- 整体「卡通城市沙盘」气质（m00594 决策）：toon 渲染、明快饱和配色、圆润夸张比例，美术规格见 [11 §6.0](11-real-beijing-3d.md)；既有建筑 pastel 灰色系、玩家建筑按类别色高饱和，形成「现状 vs 决策」的视觉对比。
- 地形配色：flat 米白 / hill 赭石 / river 蓝 / bank 浅蓝 / forest 深绿 / road 灰。
- 区块配色按大类：住宅暖黄、商业金、工业暗紫、绿地青、服务红、交通蓝、市政灰。
- 指标脉冲、落子弹跳（200ms）、拆拆除尘、推演镜头缓缓拉远——动效一律 ≤300ms，不抢决策时间。

## 5. 性能与兼容

- 首屏 JS ≤300KB gzip（Next 默认就差不多，别乱引库）。
- 3D 场景帧率：桌面（M 系 Mac Chrome）≥55fps；Android 中端机 WebView ≥30fps；draw call ≤60（[11 §6.4](11-real-beijing-3d.md)）。
- 目标浏览器：现代 Chromium/Safari 最新两版；比赛演示用 Chrome。

## 6. 前端验收标准（DoD，逐条打勾）

1. 契约 02 的每个 REST 端点与 SSE 事件都有消费方，契约测试（mock server）全绿。
2. 从建局到报告页完整走通一遍，无任何字段是 undefined。
3. 断网 10 秒恢复后，棋盘/指标/信息流与断网前一致（或经全量恢复后一致）。
4. 刷新页面后现场 100% 恢复（同 seed 同操作序列对比截图）。
5. SSE 事件乱序到达（前端故意乱序回放测试）时 UI 不崩、不重播已完成阶段。
6. 降级模式（后端 AI 关断）下信息流仍有模板文案滚动。
7. 14 种区块全部可从工具栏放置并渲染正确占地形状。
