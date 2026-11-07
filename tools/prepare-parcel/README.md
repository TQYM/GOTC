# prepare-parcel — 真实北京数据包管线（PR-27）

产出 `data/parcels/beijing_cbd/`：朝阳 CBD–通惠河 2.4×2.4km（48×48 格 × 50m）。

## 生成策略（m00974 定稿）

| 层 | 来源 |
|---|---|
| 道路 / 水系 / 绿地 / 地名 | 真实 OSM 数据（Overpass） |
| 重点地标（中国尊 528m、央视总部大楼 234m） | 真实轮廓 + 手工高度 + 识别件标记 |
| 功能性建筑（学校/医院/具名楼宇，76 栋） | 真实位置与名称保留并标出；外观为生成体块，不要求与真实一致 |
| 普通建筑（297 栋） | 扩散凝聚算法生成：道路距离衰减 × 邻接凝聚 × CBD 核心密度/高度加成，seed=20261107 可复现 |

## 用法

```bash
pip install shapely pyproj
# raw/ 缓存已生成则直接跑；重新拉数见下方 Overpass 查询
python3 tools/prepare-parcel/prepare.py
```

输入缓存（`raw/`，不入库）：`buildings.json`（way building out geom）、`landmarks_extra.json`（relation building + 央视具名 way）、`network.json`（highway/waterway/park）、`labels.json`（具名 POI out center）。
数据源：Overpass API（overpass-api.de 需带 UA `CITY20-Hackathon/1.0`；备用 overpass.private.coffee），bbox 见 `prepare.py` 的 `BBOX`。

## 产物

- `parcel.json`：元数据 + 48×48 terrain（flat/river/bank/forest/road_inherited/occupied）+ 统计
- `buildings.json`：375 栋，kind ∈ landmark（真实轮廓）/ functional（名称+体块）/ generated（扩散体块）；含 height_m、footprint（局部米制坐标）、cells
- `network.json`：道路中心线（477）+ 水系（9），Douglas-Peucker 2m 简化
- `labels.json`：199 条真实地名，importance 1–5（地标 5 / 地铁站 4 / 学校医院 3）
- `LICENSE.txt`：OSM 署名 + ODbL 1.0 共享声明

坐标系：EPSG:32650 投影后平移到 bbox 西南角原点，x 东 y 北，单位米。

调参：`SEED`（布局复现）、`TARGET_OCCUPIED`（建筑占地格数目标，默认 450）。
