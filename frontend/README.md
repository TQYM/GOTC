# frontend/

Next.js 前端：卡通风格 3D 城市沙盘（Three.js）+ 拖拽规划 + 三栏 AI 反馈流。规格见 [05-frontend](../docs/plan/05-frontend.md)、渲染层以 [11-real-beijing-3d](../docs/plan/11-real-beijing-3d.md) 为准，美术与交互细化见 [13-refined-art-and-interaction](../docs/plan/13-refined-art-and-interaction.md)，不限时与存档见 [10-persistence-sync](../docs/plan/10-persistence-sync.md)；唯一接口是 [02 契约](../docs/plan/02-data-contract.md)。

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript strict · Tailwind CSS 4 · Three.js + @react-three/fiber + @react-three/drei · ESLint + Prettier。

## 本地开发

```bash
npm ci
npm run dev          # http://localhost:3000：首页「创建新城」进入 /game?session=…；3D 渲染预览在 /sandbox
npm run lint         # ESLint（CI 强制）
npm run typecheck    # tsc --noEmit
npm run format       # Prettier
npm run build        # 生产构建（CI 强制）
```

- 浏览器只请求同源 `/api/*`，由 Next 反代到 FastAPI（`API_BASE`，默认 `http://localhost:8000`，**构建时读取**），后端无需开 CORS。
- 不连后端：首页点「离线演示」，或任意页面 URL 加 `?mock=1`（浏览器内 mock，按 10 号文档不限时语义运行，数值为演示公式）。
- `?debug=1` 暴露 `window.__city20Scene` / `window.__city20Store` 供 E2E 测试。

依赖与构建产物（`node_modules`、`.next`）不进项目卷，见仓库 AGENTS.md。

## 北京全域地图（PR-36）

`/game` 与 `/sandbox` 以北京全域（154×189km，940×813 格 @200m）为背景。可玩沙盘（48×48 @50m）按 `parcel.origin` 嵌在朝阳 CBD 片区；没有 origin 的随机沙盒或 mock 退回 CBD 数据包的 origin。游戏逻辑、数据流和契约都不变。

- **数据**：`data/parcels/beijing_full/*.json`（35MB）由 `scripts/sync-map-data.mjs` 在 `predev` / `prebuild` / `prestart` 时同步到 `public/data/`。该目录已 gitignore，不重复入库。前端静态直读，不调用后端。
- **统一建筑模型**：`lib/cityModel.ts` 把两种格式归一成 `CityBuilding`，所有渲染层都只认这个模型：
  - `beijing_full` 的 `{buildings:[…]}`
  - `beijing_cbd` 的 `{chunks:{…}}`

  模型还负责同名地标去重（故宫 5 条记录合并为 1 条）、卡通配色，以及「格 → 建筑」索引和紧凑建筑表。

- **加载**：`lib/map/fullmap.worker.ts` 在 Web Worker 里完成下载（带进度）、解析和几何生成，结果以类型化数组零拷贝传回主线程。`useFullMap()` 提供进度显示和失败重试。
- **渲染**（`components/scene/map/`）：地形、水系、道路、建筑四层，各 1 个 draw call。
  - 支持 `WEBGL_multi_draw` 时用 `BatchedMesh`。每个「空间分块 × LOD 部件」是一个实例，做视锥裁剪，并按相机到包围盒的距离切换可见性。
  - 不支持时，每层退化为 1 个合并 Mesh，固定使用中档细节（可用 `?nomultidraw=1` 复现）。
  - 建筑 4 档 LOD：
    - <5km 精细：盒体 + 机房 + 坡屋顶 / 屋顶小件
    - 5–15km 中模：盒体 + 高层机房
    - 15–30km 无细节：只有盒体
    - > 30km 简模：只保留 ≥40m 的高层
  - 地标常显，其中故宫做了宫墙、午门、太和殿和院内小殿。
  - 地形 3 级分辨率（<30km / 30–80km / ≥80km），每块带裙边，挡住相邻分块之间的裂缝。
  - 道路分 3 档宽度：支路 15km 外隐藏，主次干道 60km 外隐藏。
  - 卡通着色统一用 MeshToonMaterial + 3 阶 gradientMap。普通建筑是粉彩灰白，中国尊为金色、央视为橙色。沙盘里的 CBD 既有建筑也使用同一套材质。
- **标签**：DOM billboard（不占 draw call），按相机距离分级显示：
  - importance 5 始终显示
  - importance 4 在 <45km 时显示
  - importance 3 在 <9km 时显示

  同屏最多 300 个，重叠时贪心避让。

- **拾取**：单击时，视线与「地表 + 格内建筑顶高」高程场求交，得到所在格，再经 `cells` 索引找到建筑。全程不对 7 万栋建筑做射线求交。
  - 点到学校 / 医院会弹出本地数据面板，显示服务半径内的住宅和同类设施数。建筑详情接口尚未开放，所以面板只用本地数据。
  - 沙盘内的放置 / 拆除 / 更新改造拾取不变。
  - 双击可飞抵该点。
- **相机**：400m–260km 滚轮 / 双指缩放，任意角度旋转。预设导航（全景 / CBD / 故宫 / 鸟巢 / 乡村 / 西山）为 1.2s 平滑飞行。
- **性能自查**：加 `?perf=1` 后，画布右下角显示 fps、draw call 和三角形数；加 `?debug=1` 会暴露 `window.__city20Map` 供 E2E 使用。

## 目录

```
src/
├── app/                        # 路由：/（落地页 + 创建新城）、/game?session=（游戏页）、/sandbox（渲染预览）
├── components/game/            # GameView（三栏布局 + 放置交互）、ToolBar、MetricsPanel、InfoFeed、PhaseBanner、ReportSummary、Toasts、RemoveConfirm
├── store/game.ts               # Zustand 会话 store（05 §2.4）：不限时 4 态只信后端（乱序旧事件不回退），失败零变更
├── components/scene/
│   ├── CityScene3D.tsx         # 场景入口：相机、光照/阴影、分层、性能探针
│   ├── CameraRig.tsx           # 天际线式相机操控（13 §4.1）：右键旋转、中键/WASD 平移、滚轮向光标缩放、Home 复位
│   ├── layers.tsx              # 地形 / 林木 / 既有建筑占位 / 玩家建筑（InstancedMesh）/ 悬停 / ghost
│   ├── terrainGeometry.ts      # 48×48 地面单 mesh（顶点色 + 高差侧壁 + 底座）、水面、网格线
│   ├── tileModels.ts           # 14 种区块程序化卡通模型（部件合并 + 顶点色）
│   ├── coords.ts               # 米制局部坐标（片区中心为原点）↔ 格 r,c
│   └── toon.ts                 # MeshToonMaterial + 3 阶 gradientMap
└── lib/
    ├── api/                    # CityApi 抽象：sessionsV1（当前后端）/ mockApi（离线）+ 错误人话化
    ├── sse.ts                  # fetch 流式 SSE：断线每 2s 重连 + Last-Event-ID
    ├── validate.ts             # 本地放置预校验（地形 + 占用 + 资金缓存，仅体验层）
    ├── contract.ts             # 02 契约 TS 镜像（v1 正文 + 11 §7 v1.1 扩展）
    ├── contractV2.ts           # 10 §5 API v2 预备类型（02 升版后对齐）
    ├── catalog.ts              # 01 §3 区块目录（展示/预校验用，真值以后端为准）
    ├── palette.ts              # 11 §6.0 卡通配色
    └── mock/                   # 契约形状的 mock 会话（后端真生成器产出）
```

mock 会话由 `scripts/gen_frontend_mock.py` 用后端生成器重建（seed=882314，含全部 14 种区块）。
