# GOTC-unity · Unity 版 CITY20

Cities: Skylines 机制的 Unity 独立实现，与 `frontend`（Next.js/Three.js 版）并存，共享同一套规则常数。

## 环境

- Unity **2022.3.62f3c1**（Unity 中国版编号；对应国际版 2022.3 LTS）
- 目标平台 Windows 64 位

## 打开

1. Unity Hub → Add → 选择 `unity/GOTC-unity`
2. 打开后直接 Play。工程没有预置场景依赖：`GameBootstrap` 用
   `[RuntimeInitializeOnLoadMethod(BeforeSceneLoad)]` 在建运行时把所有对象建出来。

## 操作

| 键 | 作用 |
|---|---|
| 左键 | 放置（`BuildingPlacer`） |
| 右键拖拽 | 旋转视角 |
| Shift + 左键拖拽 | 矩形划区（`ZoneBrush`） |
| 1 / 2 / 3 / 4 | 住宅 / 商业 / 工业 / 绿地 |
| Q / E | 切换放置类型 |
| WASD / 方向键 | 平移 |
| 滚轮 | 缩放 |
| F1–F6 | 信息视图（默认 / 地价 / 污染 / 交通 / 幸福 / 就业） |
| Tab | 循环信息视图 |

## 已实现的 C:S 机制

- **时间**：`SimClock` 复刻 256 帧/日、3600 帧/年、147.65625 秒/帧；速度档 `{0,1,2,4}`（3x 档实际 4 帧，与官方一致）；暂停仍走 `subStep = 0`
- **需求双轨**：`actualResidential/Commercial/Workplace` 真值 + `displayed*` 平滑显示值（`DemandSmooth = 0.10`）
- **建造闸门**：每 8 帧一个窗口、每窗口最多一栋（`GateInterval = 8`），与 C:S `ZoneManager::SimulationStep` 同构
- **建筑升级**：地价 ≥ 55 时按 `(landPrice - 50) / 200` 概率升级，每 1024 帧一轮、每轮最多 3 栋
- **财政**：日收入/日支出、30 日还贷、住宅税率 1–29%
- **区划刷子**：Shift 拖拽矩形批量放置
- **信息视图**：6 种着色模式
- **相机**：RTS 相机（WASD + 滚轮 + 右键旋转），俯角 25–80°

## 构建

```bash
# 命令行出包（Windows）
"C:\Program Files\Unity\Hub\Editor\2022.3.62f3c1\Editor\Unity.exe" ^
  -batchmode -nographics -quit ^
  -projectPath <repo>\unity\GOTC-unity ^
  -executeMethod Gotc.EditorTools.BuildWindows.Build ^
  -logFile build.log
```

产物在 `Builds/Windows/GOTC.exe`（约 74 MB）。

## 与 Web 版的差异

| 维度 | Web 版 | Unity 版 |
|---|---|---|
| 渲染 | Three.js 卡通 3D + 像素风贴图 | 单 mesh 顶点色 + URP |
| 地图 | 真实北京 OSM 48×48 | Perlin 生成 48×48 + 斜向河道 |
| 数据 | 后端 Python 帧制内核 + SSE | 全 C# 本地，无网络 |
| 存档 | SQLite 事件溯源 | 未实现 |
| AI 叙述 | DeepSeek/Qwen/Kimi | 未接入 |

Unity 版是**独立可跑的客户端原型**，用来验证机制在引擎层同样成立；数据与规则常数与 Web 版对齐，但不共享存档。
