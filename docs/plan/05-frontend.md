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
| 客户端状态 | Zustand | SaveState、同步序号与各端本地 UI 态分域存放，配合 Immer 做不可变更新 |
| 服务端状态 | 手写 fetch 封装 + SSE 管理器 | 数据形状由契约死锁，RTK Query/React Query 的收益撑不起学习成本；SSE 本来就要自己管重连 |
| 拖拽 | @dnd-kit/core | 现行主流、无障碍好，支持工具栏到 3D 场景的多格预览 |
| 图表 | 自绘 SVG（雷达图/曲线） | 报告页图表就三种，引库反而受制 |
| 地图渲染 | **Three.js + @react-three/fiber + drei**（真 3D） | 真实北京场景：既有建筑拉伸 + 城市管理者区块 instanced，细则 [11 §6](11-real-beijing-3d.md) |
| 部署 | 同仓库 `frontend/` 目录，`npm run build` 出静态 + Node 运行时 | 比赛现场一条命令起服务 |

## 2. 页面与组件树

两个路由：`/`（落地页 + 创建/加入面板）、`/game/[cityCode]`（主游戏）。未来推演、当前报告与报告历史都是主游戏页内的**本端 UI 视图**，不伪造持久化 phase，也不依赖契约外的报告查询字段；city card 可由前端按报告数据生成分享图，城市码用于邀请其他端共同经营。

### 2.1 落地页 `/`

- 标题「CITY20 · 城市管理者」+ 一句话卖点（真实北京，由你更新；AI 规划师陪你经营一座城）。
- 首次进入的欢迎三屏与引导局按 [14](14-onboarding-usability.md) 施工，可跳过；不得恢复旧 `/api/sessions`。
- 「创建新城」→ `POST /api/saves`，默认 `parcel_id="beijing_cbd"`，可选名称；成功后跳 `/game/{city_code}`。
- 「输入城市码加入」→ `GET /api/saves/{city_code}`，成功后进入同一长期存档；城市码常驻游戏页并支持一键复制。
- 自定义沙盒提供可选 `parcel_id="sandbox"` 与 seed 输入框（演示/调试用）；真实北京模式不把 seed 当作地形来源。
- 本机最近城市列表仅在 localStorage 保存 city_code 与名字，不是事实源，也不保存离线编辑副本。
- 玩法说明：不限现实时间；随时快进一年、只读推演未来、生成当前城市体检报告或请教导师，关闭报告后继续经营。

### 2.2 游戏页 `/game/[cityCode]` 布局（三栏）

```
┌──────────────┬──────────────────────────┬─────────────┐
│ 左：指标面板  │ 中：真实北京 3D 沙盘       │ 右：AI 信息流 │
│ 资金/人口/   │ 地形 + 既有资产 + 城市管理者区块 │ news/citizen│
│ 通勤/拥堵/   │ 顶部：第 N 年 + 主动操作    │ /mentor     │
│ 幸福度/绿地  │ 底部：建造工具栏           │ 滚动自动置底 │
└──────────────┴──────────────────────────┴─────────────┘
```

### 2.3 组件清单（每个组件一句话职责）

| 组件 | 职责 | 关键点 |
|---|---|---|
| CityScene3D | 3D 场景：地形/既有建筑/城市管理者区块/悬停高亮/非法格红显 | 按 [11 §6](11-real-beijing-3d.md) 分层；Raycaster 拾取换算 r,c；OrbitControls 相机 |
| ToolBar | 14 种区块的卡牌列表，拖拽源 | 卡片显示造价/占地；资金不足自动置灰（按本地缓存的 funds，真值等后端） |
| PlacementLayer | 拖拽悬停时的覆盖格预览 | 合法绿框/非法红框；多格区块按 anchor+形状展开 |
| MetricsPanel | 指标仪表盘：简化模式默认 5 指标（人口/资金/幸福度/通勤/绿地），专业模式 14 指标 | 数值变化 300ms 颜色脉冲；资金随已提交 op/SSE 更新，简化模式带人话注解（14 §2.1） |
| PhaseBanner | 持久化阶段名 + 城市年份 + 城市码 + 主动操作入口 | 无倒计时；提供快进一年、未来推演、城市诊断、请教导师 |
| InfoFeed | SSE 三栏信息流 | Last-Event-ID 重连；本端不重复提示，他端显示系统条与落格脉冲；上翻暂停自动滚 |
| ProjectionPlayer | 本端只读预览的年度播放器 | 消费完整 ProjectionResult，标注 base_year/base_seq；不写回城市状态，刷新后重新请求 |
| ReportPage/ReportDialog | 五维评分 + 城市体检标签 + 报告全文 + 历史/继续经营 | 当前时点可重复体检；本地打开/关闭，GET reports 回看最近 20 份 |
| CityStateSync | 保存与会话同步状态 | 自己/他人操作提示、断线恢复、最近城市、复制城市码、报告历史入口 |
| BuildingDetailPage | 学校/医院等特殊建筑专属页（右侧滑出，移动端全屏） | 服务概览/满意度/历史曲线/覆盖高亮/扩建，规格见 [13 §3](13-refined-art-and-interaction.md) |
| InfoViewBar | 五类信息视图覆盖层（绿地/污染/交通/教育/医疗） | 与专属页联动，见 [13 §4.2](13-refined-art-and-interaction.md) |
| LabelLayer | 真实地名 Billboard 标注（中文优先、LOD 分级） | labels.json 驱动，见 [13 §2](13-refined-art-and-interaction.md) |
| OnboardingOverlay | 7 步情境引导：高亮+一句话+真实操作完成条件 | 可跳过重玩；状态本地+存档双持久化，见 [14 §1](14-onboarding-usability.md) |
| SmartHintBar | 情境提示与一键补齐（资金不足/非法放置/服务缺口） | 人话+怎么办；点击缺口提示直接进放置模式并圈推荐格，见 14 §2 |
| RecommendMarkers | 推荐格 1/2/3 序号标记，点选即落子 | 数据来自 GET recommend，见 14 §3 |
| UndoToast | 放置后 5 秒撤销（全额返还） | 需由 PR-35 提供符合 saves v2 幂等/同步语义的领域撤销，不能用 v1 remove 代替 |

### 2.4 共享存档状态与本端 UI 状态

Zustand 必须分开保存：① 后端权威的 SaveState/last_seq；② 本端 projecting/report/loading 等 UI 态。**持久化 `Save.phase` 只有 briefing/building，projecting/report 绝不写入共享存档，也不由他端 SSE 强制切换。**

| 本端视图 | 进入条件 | 共享存档状态 | 出口 |
|---|---|---|---|
| loading | 路由进入 | 未知 | GET 存档成功 → 按 Save.phase 进入 briefing/building；404 → 回首页 |
| briefing | Save.phase=briefing | briefing | 点「开始规划」→ POST start，后端确认后 building |
| building | Save.phase=building | building | place/remove/redevelop/advance 留在 building；可主动进入本端 projecting/report |
| projecting | 本端 `POST …/project` 成功，拿到 ProjectionResult | **仍为 building** | 播放结束/取消 → 本端 building 视图；预览基于原 base_seq，不覆盖随后收到的他端 op |
| report | 本端 `POST …/report` 成功，或 GET reports 后选择历史报告 | **仍为 building** | 关闭 → 本端 building 视图；可再次诊断，报告不是终局 |

**规则：共享城市状态只认 REST 响应、snapshot/op_applied/city_year/phase_change；本端 UI 态只由本端成功响应和明确交互切换。** `phase_change` 目前只用于 briefing→building。拖拽悬停等乐观显示不得被当作已提交状态；刷新时以 GET SaveState 恢复共享现场，未持久化的推演播放可放弃，报告可从历史接口重新打开。

## 3. 关键交互设计

### 3.1 拖拽放置

- 从 ToolBar 拖出区块卡牌（@dnd-kit），悬停沙盘时 PlacementLayer 展开覆盖格预览，实时合法性用**本地预校验**（地形表 + 已占用格缓存 + 资金缓存），非法即红框禁止落下。
- 落下时调用 place 端点，请求使用 02 的 `type/anchor/orientation?/client_op_id/base_seq`：成功 → 应用完整 OperationResult、记录 seq/client_op_id + 指标脉冲；失败 → 按错误协议弹对应 toast，**本地状态零变更**。
- 本地预校验只是体验层：最终以 REST 错误协议为准（比如 phase 不合法、并发占用、既有资产必须 redevelop）。`base_seq` 仅用于回显/诊断，落后不代表后端会拒绝操作。

### 3.2 拆除与更新改造

- 进入「拆除模式」点选城市管理者已放置的 tile；二次确认弹层显示返还金额；确认后按 `tile_id/client_op_id/base_seq` 调 remove，棋盘动画消失。
- 点选 `occupied` 既有资产时进入「更新改造」，不能调普通 remove；按 anchor 调 redevelop，并展示 OperationResult 中的拆迁成本、人口/岗位扣除、幸福度变化与惩罚期限。成功后对应资产失效、覆盖格转 flat，可继续放置。

### 3.3 断线恢复与多端同步

- 页面刷新/切后台：路由重进时 `GET /api/saves/{city_code}` 全量恢复地块、城市管理者 tiles、redeveloped_asset_ids、指标、city_year、持久化 phase 与 last_seq。projecting 不写入 SaveState，刷新后回 building 视图；报告通过 `GET …/reports` 回看。
- SSE 断开：InfoFeed 顶部显示红色「连接中断，重连中…」；前端每 2s 重连一次，带 Last-Event-ID；缓冲内补发，溢出或无法补发时接受 snapshot 并整体替换共享城市状态。重连超过 30s 提示用户刷新。
- 应用 `op_applied` 前检查 seq 连续性，并按 client_op_id 去重：本端 REST 已应用的广播只更新回显，不重复落格；他端操作正常应用并显示 300ms 脉冲。seq 跳号直接 GET 全量恢复并 toast，不猜测缺失操作。
- 操作请求网络结果未知时，可用**同一 client_op_id** 安全重试，后端返回首次完整结果且不重复扣款；新的用户意图必须生成新 ID。project 可重新请求只读预览，report 可反复生成新报告。
- snapshot 只替换共享城市状态，不把其他端的本地 projecting/report 视图强制切走；本端若继续展示旧预览，必须保留其 base_year/base_seq 标记。

### 3.4 城市年份（无倒计时）

- `city_year` 来自 REST 响应与 SSE 事件（advance 后 +1），前端只展示不推算；多端同步时以 `op_applied` 事件刷新（见 [10](10-persistence-sync.md)）。
- 全项目不存在倒计时组件与 `time_left_sec` 消费方。

## 4. 视觉与动效基调

- 整体「卡通城市沙盘」气质（m00594 决策）：toon 渲染、明快饱和配色、圆润夸张比例，美术规格见 [11 §6.0](11-real-beijing-3d.md)；既有建筑 pastel 灰色系、城市管理者建筑按类别色高饱和，形成「现状 vs 决策」的视觉对比。
- 地形配色：flat 米白 / hill 赭石 / river 蓝 / bank 浅蓝 / forest 深绿 / road 灰。
- 区块配色按大类：住宅暖黄、商业金、工业暗紫、绿地青、服务红、交通蓝、市政灰。
- 指标脉冲、落子弹跳（200ms）、拆拆除尘、推演镜头缓缓拉远——动效一律 ≤300ms，不抢决策时间。

## 5. 性能与兼容

- 首屏 JS ≤300KB gzip（Next 默认就差不多，别乱引库）。
- 3D 场景帧率：桌面（M 系 Mac Chrome）≥55fps；Android 中端机 WebView ≥30fps；draw call ≤60（[11 §6.4](11-real-beijing-3d.md)）。
- 目标浏览器：现代 Chromium/Safari 最新两版；比赛演示用 Chrome。

## 6. 前端验收标准（DoD，逐条打勾）

1. 契约 02 的每个 saves v2 REST 端点与 SSE 事件都有消费方，契约测试（mock server）全绿；不得读取契约外字段。
2. 走通创建/加入→start→place/redevelop→advance×3→project→report→关闭报告继续经营→历史回看，project 前后共享城市状态不被预览覆盖。
3. 断网 10 秒恢复后棋盘/指标/信息流与后端一致；Last-Event-ID 溢出与 seq 跳号均有恢复用例。
4. 刷新后持久化现场 100% 恢复（同 parcel 数据版本、同操作序列）；projecting/report 不写入 Save.phase，历史报告可重新打开。
5. SSE 乱序、重复 op、本端广播与 snapshot 到达时 UI 不崩、不重复落格、不回滚较新的共享状态。
6. AI 关断时信息流仍有模板文案，导师主动请教与报告模板链路可用。
7. 14 种区块全部可放置并渲染正确占地形状；真实北京既有资产只能 redevelop。
8. 两浏览器使用同一城市码交替操作最终一致，自端不重复、他端有提示；一端看报告/推演时另一端仍可建设。
9. PR-33～35 完成后另验：7 步引导可走完/跳过、简化模式默认开启、推荐位可落子、5 秒撤销资金地形全恢复（[14](14-onboarding-usability.md)）。
