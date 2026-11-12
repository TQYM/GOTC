# 16 · 像素风 UI 与地图配色统一（PR-39 ~ PR-42）

> 目标：把 PR-37 的 WorldBox 深棕金边 HUD，换成**轻松活泼的像素游戏 UI**；同时让 3D 沙盘的配色、材质与描边和 UI 属于同一套视觉语言。
> 边界：只动表现层。不改 [02](02-data-contract.md) 契约、不改 store 与玩法逻辑、不改 HUD 布局位置（PR-37/38 的交互骨架保留），所有 `data-testid` / `aria-*` 原样保留。

## 1. 现状诊断（基于 main@4044772）

| 层 | 现状 | 问题 |
|---|---|---|
| UI 令牌 | `globals.css` 两套并存：05 §4 蓝图色（`--bg/--accent`，仅落地页底纹与少量组件在用）+ PR-37 `--wb-*` 深棕金边（12 个组件、约 200 处引用） | 深棕 + 金细边 + 毛玻璃，气质偏「严肃策略游戏」；与浅蓝天空 + 白灰场景割裂 |
| 形状 | 全部 `rounded-full` / `rounded-2xl`、`backdrop-blur`、柔和大阴影 | 与像素风正相反 |
| 字体 | 系统黑体（PingFang / 雅黑） | 无游戏感 |
| 图标 | 全部 emoji（🏗️🔨🏚️✋📊💬…） | 各平台渲染不一致（截图里 Windows 上灰扑扑），无法统一风格 |
| 场景·地形 | `src/lib/palette.ts` 米白 `#F5F0E6` 地面；`lib/scene.ts` 另有一套偏灰绿 `TERRAIN_COLORS` | **两套地形色板并存**，且都不是 UI 色 |
| 场景·既有建筑 | `RealCityLayers` 4 类均为 `#c4c0ba ~ #e8e6e1` 灰白，`meshStandardMaterial` + flatShading | 截图里整城是「白模」，玩家建筑的彩色被淹没；光照模型也与玩家建筑的 Toon 材质不一致 |
| 场景·路网 | 道路 `#59636b` 深灰、铁路 `#4f8edc` 蓝 | 铁路与河道同色系，读图易混 |
| 场景·玩家建筑 | `tileModels.ts` 程序化圆角体块 + Toon 三阶渐变，配色来自 `CATEGORY_COLORS` | 风格已偏卡通，但圆角与像素风冲突，无描边 |
| 场景·标签 | Canvas 绘制的深色圆角牌 + sans-serif | 远看是一堆小黑块（见截图） |
| 渲染 | `antialias: true`，DPR 1~2，PCF 软阴影 | 全分辨率平滑渲染，没有任何像素感 |

结论：问题不在单个组件，而是**缺一套 UI 与场景共用的色板**。方案的核心是先立「一份色板、两处消费」，再分别换皮。

## 2. 设计方向：「像素小镇」

关键词：**明亮、厚描边、硬阴影、方块、会弹的按钮**。参考气质是 16-bit 经营 / 模拟类游戏的 HUD：奶油色纸面板 + 深靛蓝描边 + 不模糊的错位投影，按下去会「陷进去」。

五条视觉规则：

1. **没有圆角，只有阶梯角**：面板四角用 2px 台阶切角（`clip-path` 或 box-shadow 叠台阶），不用 `border-radius`。
2. **描边永远是墨色**：所有面板、按钮、卡牌、3D 建筑都用同一种深靛 `ink-900` 描边，这是 UI 与场景统一的第一抓手。
3. **阴影是硬的**：`box-shadow: 4px 4px 0 <ink 35%>`，不用 blur，不用 backdrop-filter。
4. **颜色只从色板取**：组件与 three.js 都禁止再写裸十六进制（lint 规则见 §7）。
5. **动画走台阶**：位移/闪烁用 `steps(n)`，弹出用 120ms 的 overshoot；保留 `prefers-reduced-motion`。

## 3. 统一色板「CITY20 Pixel 24」

单一来源：`src/lib/palette.ts` 导出 `PX`，`globals.css` 的 `--px-*` 变量与其一一对应（单测校验两边一致，防漂移）。场景与 UI 同时消费。

### 3.1 UI 基础色

| 令牌 | 值 | 用途 |
|---|---|---|
| `ink-900` | `#2A2340` | 描边、正文、3D 描边线 |
| `ink-600` | `#5B5277` | 次要文字 |
| `paper-50` | `#FFF8E7` | 面板底、标签牌底 |
| `paper-200` | `#F6E3B8` | 卡牌底、面板内凹区 |
| `paper-400` | `#E2C48A` | 面板内描边暗部 |
| `sky-200` | `#C6ECFF` | 场景背景、落地页天空 |
| `sky-400` | `#7CCBFF` | 次级按钮、信息色 |
| `ok` / `bad` / `warn` | `#3CCB6E` / `#FF4F5E` / `#FFB020` | 放置合法 / 非法 / 警告；指标涨跌 |

### 3.2 分类色（UI 卡牌标记 = 3D 玩家建筑主色）

| 分类 | 值 | | 分类 | 值 |
|---|---|---|---|---|
| 住宅 `sun` | `#FFC93C` | | 服务 `berry` | `#FF5C7A` |
| 商业 `orange` | `#FF8A3D` | | 交通 `blue` | `#3D8BFF` |
| 工业 `grape` | `#9D7BFF` | | 市政 `slate` | `#8A97B4` |
| 绿地 `mint` | `#3DD68C` | | | |

主按钮（开始规划、创建新城、快进）用 `sun` 底 + `ink` 描边，与住宅同色——黄色就是这个游戏的「品牌色」。

### 3.3 场景色

| 要素 | 顶面 | 侧面 / 暗部 | 说明 |
|---|---|---|---|
| 平地 flat | `#9BDE6E` 草绿 | `#77C25A` | 由米白改为草地，整城立刻「活」起来；格子按棋盘格 ±4% 明度交错，出像素地砖感 |
| 既有用地 occupied | `#F3E2B3` 沙色 | `#E2C48A` | 街坊地坪，与 `paper` 同系 |
| 丘陵 hill | `#D6B97A` | `#B8965A` | |
| 林地 forest | 地 `#77C25A`，树冠 `#3FAE5A` / `#6FD66B` / `#A6E36A` 三色随机 | 树干 `#A8683F` | |
| 河道 river / 河岸 bank | 水 `#46B4F2`，岸 `#9EE3FF` 浅水带 | 河床 `#2F86C9` | 水面加 1 圈浅色像素岸线 |
| 道路 | `#6B6F8E` | 路缘 `#A7ABC6`，标线 `paper-50` | |
| 铁路 | `grape` `#9D7BFF` | | 与河道蓝彻底分开 |
| 沙盘底座 plinth | 顶边 1 层草皮 `#77C25A` | 泥土 `#A8683F` → `#7A4A2E` 两层分带 | 「像素浮岛」剖面，取代现在的蓝灰底座 |

### 3.4 既有真实建筑（4 类，取分类色的浅色版，墙 / 屋顶分色）

| 类别 | 墙 | 屋顶 |
|---|---|---|
| residential | `#FFE7B0` | `#FF9E6B` |
| workplace | `#CFE7FF` | `#7CCBFF` |
| industrial | `#E2DAFF` | `#9D7BFF` |
| civic | `#FFD6DE` | `#FF5C7A` |

原则：**真实城市是浅色底景，玩家建筑是高饱和主角**。既有建筑浅、玩家建筑深，一眼分清「我盖的」和「原来的」。

## 4. UI 方案

### 4.1 字体

- 中文像素字体：**缝合像素字体 Fusion Pixel Font 12px**（SIL OFL 1.1，覆盖简体常用字），自托管到 `public/fonts/`，不依赖外网（四端离线壳也能用）。
- 体积控制：静态 UI 文案按字表子集化（构建脚本 `scripts/subset-font`，产物几十 KB）首屏即用；AI 叙述等动态文本用完整字库，`font-display: swap` 懒加载，未到达前回退系统字体。
- 数字：资源栏、年份、价格用同字体的等宽数字（`tabular-nums`）。
- 像素字体只在 12 / 24 / 36px（整数倍）使用，避免非整数缩放发糊；正文最小 12px。

### 4.2 组件令牌（`px-*` 取代 `wb-*`，类名一一映射，降低改动面）

| 旧 | 新 | 像素化规格 |
|---|---|---|
| `wb-panel` | `px-panel` | `paper-50` 底、3px `ink` 描边、阶梯角、内侧左上 2px 白高光 / 右下 2px `paper-400` 暗边、硬阴影 4px |
| `wb-round` | `px-btn` | 52×52 方块按钮；hover 上浮 2px；**按下下沉 3px 且阴影消失**；`aria-pressed` 时 `sun` 底 |
| `wb-pill` | `px-slot` | 资源「物品槽」：左侧 24px 彩色方格内放像素图标，右侧数字 |
| `wb-card` | `px-card` | 背包格：顶部 4px 分类色条、32px 区块 sprite、底部金币图标 + 价格 |
| `wb-tab` | `px-tab` | 文件夹页签：选中项与面板同底色并「接」到面板上 |
| `wb-anim-*` | `px-anim-*` | 入场 `steps(4)` 上移 8px；Toast 弹出 overshoot；数值变化 `metric-pulse` 改为闪 2 次 |

### 4.3 图标

- 功能图标：**pixelarticons**（MIT，24px 网格，SVG，`shape-rendering: crispEdges`），替换所有 emoji：建造 / 拆除 / 改造 / 选择 / 面板 / 消息 / 快进 / 推演 / 报告 / 导师 / 存档等。
- 14 种区块：自绘 16×16 像素 sprite（与 3D 模型同色同形），用于建造卡牌、详情卡头图、拖拽浮层；以 `rect` 数组的 TS 常量存放，零图片资源。
- 资源栏图标：金币、小人、笑脸、公交、树叶 5 个 16×16 sprite。

### 4.4 各界面要点（布局位置不变）

| 界面 | 改法 |
|---|---|
| 落地页 | 天空渐变 + CSS 像素云 + 底部像素北京天际线剪影（国贸三期、中国尊轮廓）；标题像素字 + 墨色错位投影；「开一座城」做成游戏存档窗 |
| 左上城市徽章 | 方形像素头像框（首字）+ 城市名 + 第 N 年；城市码做成可点击复制的「票据」样式 |
| 顶部资源栏 | 5 个 `px-slot` 并排为一条状态栏；数值涨跌在数字旁弹出 `+12` / `-3` 像素飘字 |
| 右上阶段 / 时间 | 方块按钮组；快进按钮带 `steps` 的转动沙漏 |
| 左下能力坞 | 方块快捷栏，按钮下方标 1–6 数字键位（视觉提示，键位功能另议）；当前工具提示做成对话气泡 |
| 建造抽屉 | 「背包」：页签 + 6 列格子；不可建造的格子灰化并显示锁 |
| 右侧城市 / 动态面板 | 动态流做成像素对话框，三个 AI 角色各配 32px 像素头像（数据大脑 / 市民之声 / 规划导师） |
| 详情卡 TileSheet | 卡头放区块 sprite + 分类色条；动作按钮用 `px-btn` 横排 |
| 放置提示 | 非法 `bad` 红底白字像素条、警告 `warn` 黄底墨字；带 2 帧抖动 |
| 简报 / 报告弹窗 | 大号 `px-panel` + 卷轴式标题条 |

## 5. 地图场景方案

分两层：**A 配色与材质统一**（必做、低风险）+ **B 像素化渲染**（核心观感、可开关）。

### 5.1 A · 配色与材质

1. **合并地形色板**：`lib/scene.ts` 与 `src/lib/palette.ts` 的两套 `TERRAIN_COLORS` 合并为 §3.3 一套，`lib/scene.ts` 改为从 `palette` 导入。
2. **既有建筑换材质**：`meshStandardMaterial` → 与玩家建筑相同的 `toonMaterial({ vertexColors: true })`；挤出几何时按面法线写顶点色——`normal.y > 0.5` 写屋顶色、其余写墙色（§3.4），侧面再按朝向 ×0.85 / ×0.92 区分两侧，形成像素画常见的「顶亮、左中、右暗」三面。
3. **玩家建筑去圆角**：`RoundedBoxGeometry` → `BoxGeometry`（体素感），模型造型不变；`hipRoof` 改阶梯式屋顶（2~3 层叠块），与像素图标同形。
4. **墨色描边**：玩家建筑 + 既有建筑各生成一份 `EdgesGeometry(thresholdAngle≈30°)`，`LineBasicMaterial(ink-900, opacity 0.6)`；跟随既有建筑的 chunk 缓存一起生成与释放，不新增可见性逻辑。
5. **光照**：保留 `flat` + Toon 三阶；渐变阶改为更硬的 `[140, 210, 255]`；阴影改 `shadows="basic"`（无过滤硬阴影，更像像素画）；天空 / fog 改 `sky-200`。
6. **底座**：plinth 侧壁按高度分两色泥土带 + 顶边一圈草皮，做成「像素浮岛」。
7. **地名标签**：Canvas 牌改为 `paper-50` 底 + 2px `ink` 描边 + 下方小三角，像素字体绘制，`imageSmoothingEnabled=false`、纹理 `NearestFilter`。
8. **交互反馈**：悬停框 `sun` 色 + `steps(2)` 闪烁；ghost 合法 / 非法分别用 `ok` / `bad`；拆除覆盖框 `bad`。

### 5.2 B · 像素化渲染（低分辨率渲染 + 最近邻放大）

- 做法：`<Canvas dpr={pixelScale}>`，`gl.antialias=false`，canvas 加 CSS `image-rendering: pixelated`。整幅 3D 以 1/2（默认）或 1/3 分辨率渲染后按整数倍放大，描边线天然变成 1 个「大像素」宽的像素轮廓。
- 画质开关：设置里提供「像素度：关 / 2× / 3×」，存 `localStorage`；触屏设备默认 2×（同时是性能优化：片元数降到 1/4）。
- 拾取：R3F 指针事件按 CSS 尺寸归一化，与 DPR 无关；`DebugHook.cellToScreen` 用 `size`（CSS 像素）同样不受影响——需 E2E 回归一次「拾取零偏移」。
- 可选增强（P2，时间允许再做）：建筑立面按 3.2m 层高用 `onBeforeCompile` 画像素窗格；水面按 `steps` 闪烁浅色像素点。

## 6. 任务拆分（追加到 [08](08-pr-tasks.md)）

| PR | 标题 | 内容 | 前置 | 估时 |
|---|---|---|---|---|
| 39 | 像素色板与基础组件 | `palette.ts` 统一色板 + `--px-*` 变量 + 一致性单测；字体自托管与子集化脚本；`px-panel/btn/slot/card/tab/anim` 样式；`wb-*` 全量替换为 `px-*` | 37 | 4h |
| 40 | HUD 换皮与像素图标 | pixelarticons 接入；14 区块 + 5 资源 sprite；落地页、徽章、资源栏、能力坞、抽屉、面板、详情卡、弹窗逐个换皮；删除 emoji | 39 | 5h |
| 41 | 场景配色与材质统一 | §5.1 第 1–8 条 | 39 | 4h |
| 42 | 像素化渲染与画质开关 | §5.2；性能记录；四端截图回归 | 41 | 3h |

PR-40 与 PR-41 互不依赖，可并行。

### DoD（每张卡通用 + 专项）

- [ ] 前端 `npm ci && npm test && npm run lint && npm run build` 全绿。
- [ ] 所有 `data-testid` / `aria-*` 保留，既有测试不改断言即通过。
- [ ] 组件与场景代码中不再出现裸十六进制颜色（`palette.ts` 与 `globals.css` 令牌定义处除外）。
- [ ] 375px 宽手机与 1600px 桌面截图各 1 张，更新 `docs/screenshots/`。
- [ ] 无 LLM key 打完一局（07 降级验收不回退）。
- [ ] PR-41/42：真实 CBD 片区桌面 ≥ 50fps、draw call 增量 ≤ 8（描边层），在 `?debug=1` 统计面板记录前后数据。
- [ ] PR-42：像素度 2× 下拾取零偏移 E2E 通过。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 中文像素字体体积大 | 静态文案子集 + 动态文本懒加载完整字库；首屏只等子集 |
| 像素字体 12px 在 375px 手机上信息密度下降 | 手机端资源栏只保留 3 个核心槽，其余折叠进城市面板 |
| 描边线增加几何与 draw call | 跟随 chunk 合批，每类 1 个 `LineSegments`；性能不达标时远景 chunk 不出描边 |
| 低分辨率渲染让地名标签难读 | 标签已改像素字体按整数倍绘制；仍不清晰时标签改为 HTML 覆盖层（不进低分辨率画布） |
| 草绿地面让「绿地」分类不够醒目 | 绿地 `mint` 比草地更亮更青，且玩家建筑有墨色描边；不够时地面降饱和到 `#B5E08F` |
| 素材授权 | 只用 OFL（字体）与 MIT（图标）素材，`LICENSE` 来源声明同步追加 |

## 8. 二期：经营 UI 像素化与地图读图（基于 main@afd183e，2026-11-11）

> 背景：PR-39～42 的像素风已在 `8c85c55` 并入 main（落地页、资源栏、城市徽章、快捷栏、时间按钮组、建造背包、详情卡、场景色板）。之后 `d92ecf7` 关闭了地图像素化，`0ebed08` 换成 48km 东西朝海棋盘，`6900e51` 按 C:S 加了一整套经营 UI。本节只处理这三件事带来的新落差。
> 边界不变：只动表现层；C:S 的 UI **结构**（13-cs-rebuild-log 的面板、速度档、需求条）保留，只换皮；不重新打开整图像素化（`PIXEL_ART_ENABLED=false` 视为产品决定）。

### 8.1 现状诊断

| 级别 | 问题 | 证据 |
|---|---|---|
| 高 | **第四套视觉语言**：C:S 经营 UI 用深色半透明 + 圆角 + 毛玻璃 + Tailwind 的 emerald / rose / slate，和旁边的像素组件并排出现 | `SpeedControl` `DemandPanel` `SideDock` 及其 6 个面板（财政/市民/行政区/线路/统计/政策）、`MilestoneBar` `WeatherBadge` `TutorialOverlay` `TileActions` `scene/map/MapHud` `scene/map/BuildingPanel`：共 15 个组件，`px-*` 类 0 处，`rounded*` 46 处、`backdrop-blur` 15 处 |
| 高 | **48km 棋盘读不出城市**：2 万栋既有建筑同一种奶油墙 + 浅色顶，高度统一放大 9.2 倍（`worldSize/5200`），远景是一片细高的「针林」；地名 DOM 层最多 900 条 | `lib/scene.ts heightExaggeration`、`RealCityLayers paintFaces`、`ParcelLabels slice(0, 900)` |
| 高 | **全域底图没有接色板**：`fullmap.worker.ts` 自带一套地形色（`#EBE7D8` 地面、`#F6D68C` 快速路）和标签色，与 `PX` 无关。CBD 存档时沙盘外圈正是这张图，沙盘内外两套配色 | `src/lib/map/fullmap.worker.ts:56,79-88`、`scene/map/labelOverlay.ts:10-12` |
| 中 | 侧栏图标用汉字（¥ 人 区 车 / 图 法）；速度档、天气、引导里还有 emoji | `SideDock.TABS`、`SpeedControl`、`WeatherBadge`、`TutorialOverlay` |
| 中 | 右侧一列挤了三组控件：`SideDock` 右侧按钮（top-36）、时间/工具按钮组、信息视图竖条，加上错误提示也落在这里，互相压 | 1440×900 截图 |
| 中 | 字体：站酷庆科黄油体不是像素字体，和 Pixelify Sans 不同语言；Pixelify 的「5」和「S」几乎一样，资金 500 万读成「S00 万」；资源栏标签约 9px | `globals.css --font-sans` |
| 中 | 新手引导整屏压暗加模糊，看不到要点击的按钮 | `TutorialOverlay` |
| 低 | 需求条 R/C/I 用 emerald / sky / amber，和建造卡的住宅黄、商业橙、工业紫对不上 | `DemandPanel` |
| 低 | 道路格 `#6B6F8E` 在 400m 一格的大棋盘上成片出现，远景被深色块切碎 | `TERRAIN_COLORS.road_inherited` |

### 8.2 地图：读图优先（不开像素化也能和 UI 一个味道）

| 项 | 做法 | 状态 |
|---|---|---|
| 街区主题屋顶 | civic / residential 屋顶按世界坐标分块（块边长 = 棋盘边长 / 24，48km 下约 2km）取 6 种屋顶色之一（`orange/blue/sun/grape/mint/berry` 的 light 版），墙保持奶油。整城读出片区肌理，与 C:S 行政区概念对得上；有行政区数据后改按行政区着色 | 原型 `feat/pixel-ui-phase2` |
| 高度压缩 | `compressHeight(h, k)`：20m 以下按 k 倍，超出部分只放大 0.35k。低层仍看得见，高层不再变针 | 原型 |
| 道路格提亮 | `road_inherited` 由 `#6B6F8E` 改 `#A7ABC6`（= 路缘色）；真实路网条带保留深色，形成「浅地 + 深线」 | 原型 |
| 地名上限 | 48km 地名上限 900 → 240；后续按缩放分三档：远景只显示区名（`sun` 底大号牌）+ 前 20 个地标，中景加街道，近景全开 | 上限已原型，分档待做 |
| 全域底图换色 | `fullmap.worker.ts` 改为从 `palette.ts` 取色；棋盘外的全域地图用 PX 的**褪色版**（饱和度 −35%、明度 +8%），让棋盘是舞台、外圈是背景 | 待做 |
| 墨色描边 | 只给玩家建筑和 importance≥4 的地标加 `EdgesGeometry` 墨线（每类 1 个 `LineSegments`），一眼区分「我建的 / 地标 / 普通楼」 | 待做 |
| 落地弹跳 | 新建筑 `steps(4)` 由 0.6→1.08→1 缩放 + 4 个像素尘土方块，配合已有的镜头飞近 | 待做 |
| 近景像素化（可选） | 相机距离 < 1.5km 时才启用 `PixelPass` 2×，远景保持平滑；设置里默认关 | 待产品确认 |

### 8.3 经营 UI：只换皮，不改 C:S 结构

- **新增 4 个基础件**（`components/ui/`）：`PxWindow`（标题条 + 像素图标 + 关闭，取代 `bg-slate-900/85 rounded-lg backdrop-blur`）、`PxStatRow`（标签 / 数值行，涨绿跌红用 `ok/bad`）、`PxSlider`（分段滑块，用于税率与预算，12 格一档）、`PxBar`（分段条，用于需求、里程碑、日进度）。
- **SideDock**：汉字图标换 `pixelArt.ts` 新增的 6 个 12×12 图标（金币袋、小人、旗帜、公交、柱状图、卷轴），按钮用 `px-btn` 小号；左右两列合并到左侧一列，挪到城市徽章下方。
- **SpeedControl**：并入顶部资源栏下沿，做成「磁带机」四键（暂停 / 1× / 2× / 3×），当前档 `sun` 底；日进度用 `PxBar` 24 格。
- **DemandPanel**：R/C/I 改用 `sun / orange / grape`，缩成资源栏右端的 3 根竖条，释放左下角。
- **右侧一列**：时间/工具按钮组与信息视图竖条合并成一个「工具架」；提示条统一挪到资源栏正下方居中。
- **TutorialOverlay**：去掉全屏模糊；用规划导师头像 + 像素对话气泡指向目标控件，目标控件外围加 4px `sun` 闪框（`steps(2)`）。
- **MapHud / BuildingPanel / TileActions**：改用 `PxWindow`，与 `TileSheet` 详情卡同一结构。

### 8.4 字体

- 中文 UI 小字（≤16px）：**缝合像素字体 Fusion Pixel 12px 简体比例版**（OFL-1.1，`@fontsource/fusion-pixel-12px-proportional-sc`，31,345 字形，完整 woff2 约 600KB），只用 12 / 24px。
- 站酷庆科黄油体只留给 ≥24px 的标题（落地页大标题、弹窗标题）。
- 数字：资源栏、价格、年份改用 Fusion Pixel 自带的拉丁数字（「5」与「S」可区分），保留 `tabular-nums`。
- AI 长段落（新闻、导师点评、报告正文）继续系统无衬线 14–15px。

### 8.5 任务卡（追加，编号接 PR-42）

| PR | 标题 | 内容 | 前置 | 估时 |
|---|---|---|---|---|
| 43 | 地图读图优化 | §8.2 前四项（原型转正 + 单测：`compressHeight`、屋顶分块确定性）+ 地名三档 | — | 3h |
| 44 | 全域底图接色板 | §8.2「全域底图换色」：worker 从 palette 取色、褪色版、`labelOverlay` 换 PX | 43 | 3h |
| 45 | 经营 UI 像素化 | §8.3 全部：4 个基础件 + 15 个组件换皮 + 布局归并；testid / aria 不变 | — | 5h |
| 46 | 字体与手感 | §8.4 字体替换；§8.2 描边、落地弹跳；可选近景像素化 | 45 | 3h |

PR-43/44 与 PR-45 可并行。DoD 沿用 §6，另加：

- [ ] 1440×900 与 375px 宽各一张截图，覆盖 48km 棋盘与 CBD 两种存档。
- [ ] 48km 棋盘默认机位：同屏可读地名 ≤ 60 个；楼体最高处不超过屏高 1/3。
- [ ] 经营面板中不再出现 `rounded-*`、`backdrop-blur`、Tailwind 色名（`emerald-*` 等），颜色只取 `--px-*`。
- [ ] 现有 3 个 lint error（`TutorialOverlay.tsx:29`、`CitizenDots.tsx:154/170`，main 上已存在）在 PR-45 / PR-46 中顺手修掉。
