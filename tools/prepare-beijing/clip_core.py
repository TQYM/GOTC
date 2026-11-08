"""从 beijing_full（全域 940×813@200m）裁出城四区方形棋盘 beijing_core（120×120@400m）。

输出与后端 Parcel / NetworkFile / BuildingsFile 契约一致的五个文件，
并附带 core_mask（哪些格属于东西朝海，供前端限制玩家操作）。

用法：python3 tools/prepare-beijing/clip_core.py
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "parcels" / "beijing_full"
DST = ROOT / "data" / "parcels" / "beijing_core"

SRC_CELL = 200.0
DST_CELL = 400.0
SCALE = int(DST_CELL / SRC_CELL)  # 2
DST_SIZE = 120

# 源网格窗口（2×2 聚合后正好 120×120）
COL0 = 214  # 116.10E
ROW0 = 193  # 39.75N

# 城四区（东西朝海）bbox，用于 core_mask
CORE = {"south": 39.75, "west": 116.10, "north": 40.10, "east": 116.66}
FULL = {"south": 39.40, "west": 115.60, "north": 41.10, "east": 117.50}

TERRAIN_MAP = {
    "flat": "flat",
    "farmland": "flat",
    "hill": "hill",
    "river": "river",
    "bank": "bank",
    "forest": "forest",
    "road_inherited": "road_inherited",
    "occupied": "occupied",
}

# 全域包 building.category 是区块类型，转后端 ExistingAsset.category
CATEGORY_MAP = {
    "res_low": "residential",
    "res_mid": "residential",
    "res_high": "residential",
    "shop": "workplace",
    "cbd": "workplace",
    "industrial": "industrial",
    "light_industry": "industrial",
    "civic": "civic",
    "school": "civic",
    "hospital": "civic",
}

POPULATION = {"residential": 0, "workplace": 0, "industrial": 0, "civic": 0}
JOBS = {"residential": 0, "workplace": 120, "industrial": 90, "civic": 40}


def core_points() -> tuple[list[list[float]], list[list[int]]]:
    """窗口内每格中心对应的经纬度 → 判定是否在东西朝海内。"""
    mask: list[list[int]] = []
    lons: list[list[float]] = []
    for r in range(DST_SIZE):
        row_mask = []
        row_lon = []
        for c in range(DST_SIZE):
            # 目标格对应的源格中心（米）→ 经纬度
            src_r = ROW0 + r * SCALE + 0.5
            src_c = COL0 + c * SCALE + 0.5
            lon = FULL["west"] + (src_c / 813) * (FULL["east"] - FULL["west"])
            lat = FULL["south"] + (src_r / 940) * (FULL["north"] - FULL["south"])
            row_mask.append(1 if CORE["west"] <= lon <= CORE["east"] and CORE["south"] <= lat <= CORE["north"] else 0)
            row_lon.append([round(lon, 5), round(lat, 5)])
        mask.append(row_mask)
        lons.append(row_lon)
    return lons, mask


def build_terrain(src: dict) -> tuple[list[list[str]], list[list[float]], dict]:
    src_terrain = src["terrain"]
    src_elev = src.get("elevation") or [[0.0] * len(src_terrain[0]) for _ in src_terrain]
    terrain: list[list[str]] = []
    elevation: list[list[float]] = []
    counter: Counter[str] = Counter()
    for r in range(DST_SIZE):
        row_t = []
        row_e = []
        for c in range(DST_SIZE):
            block = []
            elev = 0.0
            for dr in range(SCALE):
                for dc in range(SCALE):
                    sr = ROW0 + r * SCALE + dr
                    sc = COL0 + c * SCALE + dc
                    if 0 <= sr < len(src_terrain) and 0 <= sc < len(src_terrain[sr]):
                        block.append(TERRAIN_MAP.get(src_terrain[sr][sc], "flat"))
                        elev += float(src_elev[sr][sc])
            majority = Counter(block).most_common(1)[0][0] if block else "flat"
            row_t.append(majority)
            row_e.append(round(elev / max(1, len(block)), 1))
            counter[majority] += 1
        terrain.append(row_t)
        elevation.append(row_e)
    return terrain, elevation, dict(counter)


def build_buildings(src: dict) -> dict:
    """米制坐标平移（减窗口原点），格坐标改按 400m 重算。"""
    ox = COL0 * SRC_CELL
    oy = ROW0 * SRC_CELL
    half = DST_SIZE * DST_CELL / 2
    chunks: dict[str, list] = {}
    kept = 0
    seen_ids: dict[str, int] = {}
    for b in src.get("buildings", []):
        cx, cy = b.get("center") or b["footprint"][0]
        if not (ox <= cx < ox + DST_SIZE * DST_CELL and oy <= cy < oy + DST_SIZE * DST_CELL):
            continue
        local = [[round(p[0] - ox, 1), round(p[1] - oy, 1)] for p in b["footprint"]]
        rc = int((cy - oy) // DST_CELL)
        cc = int((cx - ox) // DST_CELL)
        cells = []
        for p in local:
            r2 = int(max(0, min(DST_SIZE - 1, p[1] // DST_CELL)))
            c2 = int(max(0, min(DST_SIZE - 1, p[0] // DST_CELL)))
            if [r2, c2] not in cells:
                cells.append([r2, c2])
        raw_cat = b.get("category", "res_mid")
        category = CATEGORY_MAP.get(raw_cat, "residential")
        area = 0.0
        for i in range(1, len(local)):
            area += local[i - 1][0] * local[i][1] - local[i][0] * local[i - 1][1]
        area = abs(area) / 2
        levels = max(1, round(b.get("height_m", 10) / 3.2))
        population = round(area / 28) if category == "residential" else 0
        # 同一 relation（如故宫）会被源数据拆成多段，asset_id 需要加序号避免 React key 重复
        asset_id = b["id"]
        if asset_id in seen_ids:
            seen_ids[asset_id] += 1
            asset_id = f"{asset_id}#{seen_ids[asset_id]}"
        else:
            seen_ids[asset_id] = 0
        asset = {
            "asset_id": asset_id,
            "category": category,
            "height_m": float(b.get("height_m", 10)),
            "levels": levels,
            "footprint": local,
            "cells": cells,
            "base_area_m2": round(area, 1),
            "population": population,
            "jobs": JOBS.get(category, 0),
            "demolition_cost": round(area * (3 if category == "residential" else 8), 0),
            "upkeep": round(area * 0.4, 0),
            "height_source": "osm" if b.get("kind") == "landmark" else "estimate",
            "name": b.get("name") or None,
            "landmark": bool(b.get("kind") == "landmark"),
        }
        key = f"{rc}:{cc}"
        chunks.setdefault(key, []).append(asset)
        kept += 1
    return {"parcel_id": "beijing_core", "data_version": "real-2026.11", "chunks": chunks}


def build_network(src: dict) -> dict:
    ox = COL0 * SRC_CELL
    oy = ROW0 * SRC_CELL
    span = DST_SIZE * DST_CELL
    features = []
    for item in src.get("roads", []):
        line = item.get("line") or []
        pts = [[round(x - ox, 1), round(y - oy, 1)] for x, y in line]
        pts = [p for p in pts if -500 <= p[0] <= span + 500 and -500 <= p[1] <= span + 500]
        if len(pts) < 2:
            continue
        features.append(
            {
                "feature_id": item.get("id", f"road-{len(features)}"),
                "kind": "road",
                "highway": item.get("kind"),
                "name": item.get("name"),
                "path": pts,
            }
        )
    for item in src.get("water", []):
        line = item.get("line") or []
        pts = [[round(x - ox, 1), round(y - oy, 1)] for x, y in line]
        pts = [p for p in pts if -500 <= p[0] <= span + 500 and -500 <= p[1] <= span + 500]
        if len(pts) < 2:
            continue
        features.append(
            {
                "feature_id": item.get("id", f"water-{len(features)}"),
                "kind": "water",
                "highway": None,
                "name": item.get("name"),
                "path": pts,
            }
        )
    return {"parcel_id": "beijing_core", "data_version": "real-2026.11", "features": features}


def build_labels(src: dict) -> dict:
    ox = COL0 * SRC_CELL
    oy = ROW0 * SRC_CELL
    span = DST_SIZE * DST_CELL
    labels = []
    for item in src.get("labels", []):
        pos = item.get("pos") or [item.get("x"), item.get("y")]
        x, y = pos[0], pos[1]
        if x is None or y is None:
            continue
        lx, ly = x - ox, y - oy
        if not (0 <= lx < span and 0 <= ly < span):
            continue
        labels.append(
            {
                "name": item.get("name"),
                "kind": item.get("kind"),
                "x": round(lx, 1),
                "y": round(ly, 1),
                # 区/市名是全景尺度的定位锚点，统一提到 5（全程可见）
                "importance": 5
                if item.get("kind") == "city"
                else item.get("importance", 3),
            }
        )
    return {"parcel_id": "beijing_core", "labels": labels}


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    src = json.loads((SRC / "parcel.json").read_text("utf-8"))
    terrain, elevation, counts = build_terrain(src)
    lons, mask = core_points()

    buildings = json.loads((SRC / "buildings.json").read_text("utf-8"))
    network = json.loads((SRC / "network.json").read_text("utf-8"))
    labels = json.loads((SRC / "labels.json").read_text("utf-8"))

    parcel = {
        "parcel_id": "beijing_core",
        "district_name": "北京 · 东西朝海",
        "data_version": "real-2026.11",
        "size": DST_SIZE,
        "cell_size_m": int(DST_CELL),
        "crs": "EPSG:32650（局部原点：窗口西南角，单位米，x 东 y 北）",
        "origin_m": [COL0 * SRC_CELL, ROW0 * SRC_CELL],
        "bbox_wgs84": {
            "south": round(FULL["south"] + (ROW0 / 940) * (FULL["north"] - FULL["south"]), 5),
            "north": round(FULL["south"] + ((ROW0 + DST_SIZE * SCALE) / 940) * (FULL["north"] - FULL["south"]), 5),
            "west": round(FULL["west"] + (COL0 / 813) * (FULL["east"] - FULL["west"]), 5),
            "east": round(FULL["west"] + ((COL0 + DST_SIZE * SCALE) / 813) * (FULL["east"] - FULL["west"]), 5),
        },
        "core_bbox_wgs84": CORE,
        "core_mask": mask,
        "terrain": terrain,
        "elevation": elevation,
        "inherited_road": [],
        "constraints": {
            "height_limit_m": 180,
            "green_line_m": 30,
            "buildable_ratio": 0.65,
            "briefing": {
                "text": "你接手的是北京城四区（东西朝海）。48 平方公里、二十个街道的老城更新，既要保住胡同，也要装得下新的通勤人口。",
                "source": "template",
            },
        },
        "seed": src.get("seed", 20261107),
        "buildings_url": "buildings.json",
        "network_url": "network.json",
        "labels_url": "labels.json",
        "terrain_counts": counts,
        "generation": "beijing_full 2×2 聚合裁剪（tools/prepare-beijing/clip_core.py）",
        "license": "© OpenStreetMap contributors, ODbL 1.0（见 LICENSE.txt）",
        "grid_center_wgs84": lons[0][0],
    }

    (DST / "parcel.json").write_text(json.dumps(parcel, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (DST / "buildings.json").write_text(json.dumps(build_buildings(buildings), ensure_ascii=False, separators=(",", ":")), "utf-8")
    (DST / "network.json").write_text(json.dumps(build_network(network), ensure_ascii=False, separators=(",", ":")), "utf-8")
    (DST / "labels.json").write_text(json.dumps(build_labels(labels), ensure_ascii=False, separators=(",", ":")), "utf-8")
    (DST / "LICENSE.txt").write_text(
        "beijing_core 数据包\n\n"
        "几何与地名：© OpenStreetMap contributors，ODbL 1.0（https://www.openstreetmap.org/copyright）\n"
        "由 data/parcels/beijing_full 裁剪聚合而来，仅供 CITY20 演示使用。\n",
        "utf-8",
    )
    print("terrain", counts)
    print("core cells", sum(sum(row) for row in mask), "/", DST_SIZE * DST_SIZE)
    for name in ("parcel", "buildings", "network", "labels"):
        print(name, (DST / f"{name}.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
