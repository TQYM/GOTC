# prepare-beijing — 北京全域数据包管线

产出 `data/parcels/beijing_full/`：北京全域约 154×189km（200m/格，约 772×946 格）。

## 生成策略（m01155 定稿）

| 层 | 来源 |
|---|---|
| 城四区（东城/西城/朝阳/海淀） | 真实 OSM 骨架：主干道+次干道、水系、公园、具名建筑、地标 |
| 全市其余区 | 扩散 + 噪声生成：建筑沿真实道路扩散，urbanity 连续场控制密度/高度/类别 |
| 城乡融合 | urbanity = 核心(24km) + 真实城镇点(7km) 距离衰减场 + fBm 噪声扰动边界；城市→近郊→乡村建筑高度/密度连续渐变，乡村聚落锚定真实 village 点（2–14 栋民居成簇），农田/林地噪声分片 |
| 地形 | 西山(lon<116.10–116.42) + 燕山(lat>40.10–40.45) 掩膜 + fBm → 高程 250–1550m，山地压制城市生成 |
| 地标 | 故宫/天安门/鸟巢/水立方/中国尊/央视等真实轮廓+手工高度；功能建筑（学校医院等）真实位置名称+体块 |

## 用法

```bash
pip install shapely pyproj
python3 tools/prepare-beijing/fetch.py           # 分批拉取 Overpass（断点续拉，约 15–30 分钟）
python3 tools/prepare-beijing/prepare_beijing.py # 生成（约 3–5 分钟）
```

数据源：Overpass API（overpass.private.coffee 主用；overpass-api.de 备用需 UA `CITY20-Hackathon/1.0`）。

## 产物（与 beijing_cbd 同构，多 elevation 与 settlement 字段）

- `parcel.json`：元数据 + terrain（新增 farmland/hill）+ elevation（米，角点平滑见预览）
- `buildings.json`：kind ∈ landmark/functional/generated；generated 带 settlement ∈ urban/rural
- `network.json`：真实道路中心线（Douglas-Peucker 简化）+ 水系
- `labels.json`：真实地名 importance 1–5（地标5/城镇与地铁站4/学校医院景点3/村庄2）
- `LICENSE.txt`：OSM 署名 + ODbL 1.0

坐标系：EPSG:32650 投影后平移到 bbox 西南角原点，x 东 y 北，米。
调参：`SEED`（复现）、`CORE`（城四区真实骨架范围）、`BBOX`（全域范围）。

## 预览

项目根起 `python3 -m http.server 8020` 后访问 `tools/preview/beijing.html`（独立 three.js 预览，非游戏前端）。
