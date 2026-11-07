# frontend/

Next.js 前端：卡通风格 3D 城市沙盘（Three.js）+ 拖拽规划 + 三栏 AI 反馈流。规格见 [05-frontend](../docs/plan/05-frontend.md)、渲染层以 [11-real-beijing-3d](../docs/plan/11-real-beijing-3d.md) 为准，不限时与存档见 [10-persistence-sync](../docs/plan/10-persistence-sync.md)；唯一接口是 [02 契约](../docs/plan/02-data-contract.md)。

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript strict · Tailwind CSS 4 · Three.js + @react-three/fiber + @react-three/drei · ESLint + Prettier。

## 本地开发

```bash
npm ci
npm run dev          # http://localhost:3000，3D 沙盘预览在 /sandbox（含帧率 / draw call 面板）
npm run lint         # ESLint（CI 强制）
npm run typecheck    # tsc --noEmit
npm run format       # Prettier
npm run build        # 生产构建（CI 强制）
```

依赖与构建产物（`node_modules`、`.next`）不进项目卷，见仓库 AGENTS.md。

## 目录

```
src/
├── app/                        # 路由：/（落地页）、/sandbox（3D 沙盘预览，mock 数据）
├── components/scene/
│   ├── CityScene3D.tsx         # 场景入口：相机 + OrbitControls、光照/阴影、分层、性能探针
│   ├── layers.tsx              # 地形 / 林木 / 既有建筑占位 / 玩家建筑（InstancedMesh）/ 悬停 / ghost
│   ├── terrainGeometry.ts      # 48×48 地面单 mesh（顶点色 + 高差侧壁 + 底座）、水面、网格线
│   ├── tileModels.ts           # 14 种区块程序化卡通模型（部件合并 + 顶点色）
│   ├── coords.ts               # 米制局部坐标（片区中心为原点）↔ 格 r,c
│   └── toon.ts                 # MeshToonMaterial + 3 阶 gradientMap
└── lib/
    ├── contract.ts             # 02 契约 TS 镜像（v1 正文 + 11 §7 v1.1 扩展）
    ├── contractV2.ts           # 10 §5 API v2 预备类型（02 升版后对齐）
    ├── catalog.ts              # 01 §3 区块目录（展示/预校验用，真值以后端为准）
    ├── palette.ts              # 11 §6.0 卡通配色
    └── mock/                   # 契约形状的 mock 会话（后端真生成器产出）
```

mock 会话由 `scripts/gen_frontend_mock.py` 用后端生成器重建（seed=882314，含全部 14 种区块）。
