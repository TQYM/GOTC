# CITY20 离线片区数据管线

仅开发期需要网络与 GIS 依赖；FastAPI 运行时只读取 `data/parcels/`，不安装本工具也能启动。

## 数据与美术来源（吸收上游 m00974）

| 层 | 来源 |
|---|---|
| 道路 / 水系 / 绿地 / 地名 | 真实 OSM 数据（Overpass） |
| 重点地标（中国尊、央视总部等） | 真实轮廓 + 明确记录的手工高度/识别件 |
| 功能性建筑 | 真实位置与名称保留；外观可为生成体块 |
| 普通建筑 | 可使用 `prepare.py` 的道路距离衰减 × 邻接凝聚生成策略，seed 固定可复现 |

`labels.json` 保留真实中文地名与 importance LOD；资产几何和经济字段在写入运行时包前必须统一为下方 canonical schema。

## canonical 运行时包

后端与 saves v2 统一消费 `parcel.json`、`buildings.json`（`chunks`）、`network.json`（`features`）、`source.json`；网格坐标为北端 `r=0`，矢量坐标保持 EPSG:32650 局部米制 x 东 y 北。不得把上游 `prepare.py` 的南端 `r=0` 行序直接混入运行时文件。

```bash
# 在 backend 的隔离 venv 中安装工具依赖
pip install -r ../tools/prepare-parcel/requirements.txt

# 仅在更新源数据时执行：公共 Overpass 可能限流，失败不会生成合成替代数据
python ../tools/prepare-parcel/fetch_osm.py \
  --output "$BUILD_SCRATCH_ROOT/city20-gis/beijing_cbd.osm.json"

# 完全离线：投影 → 裁剪 → 栅格化 → 2m 简化 → 8×8 分片 → 打包
python ../tools/prepare-parcel/prepare_parcel.py \
  --input "$BUILD_SCRATCH_ROOT/city20-gis/beijing_cbd.osm.json" \
  --output ../data/parcels/beijing_cbd
```

`parcels.yaml` 固定 WGS84 bbox、48×48@50m 网格和现状人口/岗位/拆迁估算系数。输出原点与原始 SHA-256 记录在 `source.json`；每次生成只取决于输入、配置和纳入的 landmark/labels 记录。

上游 `prepare.py` 保留扩散生成、地标和 labels 的实现及开发期 raw 缓存读取逻辑；其旧输出字段（`id`、`footprint`、`roads/water`）不是后端契约，合入前需经统一转换，不得直接覆盖 canonical 文件。

首发范围是 CBD 核心 2.4km 网格，包含央视、中国尊/中信大厦、国贸与通惠河部分河段；不宣称覆盖东大桥至四惠的完整直线范围。高度缺失按 11 号文档默认表兜底，来源统计见 `source.json`。

许可：每片区必须保留 `LICENSE.txt`，前端展示「© OpenStreetMap contributors / ODbL 1.0」。
