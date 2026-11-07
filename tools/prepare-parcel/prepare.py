#!/usr/bin/env python3
"""CITY20 真实北京数据包管线 v2（PR-27 / 11 号文档 + m00974 修订）。

策略（用户定稿）：
- **真实保留**：道路 / 水系 / 绿地 / 地名 / 重点地标（真实轮廓+高度）
- **功能性建筑**（学校/医院/具名楼宇）：保留真实位置与名称并标出，外观用生成体块（不要求与真实一致）
- **普通建筑**：扩散凝聚算法随机生成（seed 固定可复现），道路衰减 + 邻接凝聚 + CBD 核心密度/高度加成

输入：tools/prepare-parcel/raw/{buildings,network,labels,landmarks_extra}.json
输出：data/parcels/beijing_cbd/{parcel,buildings,network,labels}.json + LICENSE.txt
"""
import json
import math
import random
import re
import sys
from collections import deque
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "tools/prepare-parcel/raw"
OUT = ROOT / "data/parcels/beijing_cbd"

BBOX = {"south": 39.8932, "west": 116.4420, "north": 39.9148, "east": 116.4700}
GRID = 48
CELL = 50.0
SEED = 20261107
TARGET_OCCUPIED = 450  # 目标建筑占地格数（含地标/功能/生成）

TF = Transformer.from_crs("EPSG:4326", "EPSG:32650", always_xy=True)
OX, OY = TF.transform(BBOX["west"], BBOX["south"])

# 重点地标：OSM 元素 id → (识别件, 手工高度)。真实轮廓保留。
LANDMARK_IDS = {"w599547918": ("zun", 528.0), "r7820447": ("cctv", 234.0)}
HEIGHT_FALLBACK = {
    "house": 3.5, "detached": 3.5, "residential": 18.0, "apartments": 21.0,
    "dormitory": 18.0, "office": 48.0, "commercial": 24.0, "retail": 12.0,
    "industrial": 7.0, "warehouse": 7.0, "school": 15.0, "hospital": 24.0,
    "hotel": 60.0, "supermarket": 8.0, "yes": 24.0,
}
CATEGORY_MAP = {
    "house": "res_low", "detached": "res_low", "residential": "res_mid",
    "dormitory": "res_mid", "apartments": "res_high", "office": "cbd",
    "commercial": "shop", "retail": "shop", "supermarket": "shop",
    "industrial": "light_industry", "warehouse": "light_industry",
    "school": "school", "university": "school", "kindergarten": "school",
    "hospital": "hospital", "hotel": "cbd",
}


def local(lon, lat):
    x, y = TF.transform(lon, lat)
    return [round(x - OX, 2), round(y - OY, 2)]


def load(name):
    p = RAW / f"{name}.json"
    return json.loads(p.read_text()).get("elements", []) if p.exists() else []


def way_polygon(el):
    geom = el.get("geometry") or []
    if len(geom) < 4:
        return None
    pts = [local(g["lon"], g["lat"]) for g in geom]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    poly = Polygon(pts)
    return poly if poly.is_valid and poly.area > 1 else None


def relation_polygon(el):
    outers = []
    for m in el.get("members", []):
        if m.get("type") == "way" and m.get("role") in ("outer", ""):
            poly = way_polygon(m)
            if poly is not None:
                outers.append(poly)
    return unary_union(outers) if outers else None


def way_line(el):
    geom = el.get("geometry") or []
    return LineString([local(g["lon"], g["lat"]) for g in geom]) if len(geom) >= 2 else None


def parse_height(tags):
    h = tags.get("height")
    if h:
        m = re.match(r"([\d.]+)", h.replace(",", "."))
        if m:
            v = float(m.group(1))
            if 2.0 <= v <= 600.0:
                return v
    lv = tags.get("building:levels")
    if lv and lv.isdigit():
        floor_h = 4.0 if tags.get("building") in ("office", "commercial", "hotel") else 3.5
        return max(3.5, int(lv) * floor_h)
    return HEIGHT_FALLBACK.get(tags.get("building", "yes"), 24.0)


def cells_covered(geom, ratio=0.3):
    out = []
    minx, miny, maxx, maxy = geom.bounds
    for r in range(max(0, int(miny // CELL)), min(GRID, int(maxy // CELL) + 1)):
        for c in range(max(0, int(minx // CELL)), min(GRID, int(maxx // CELL) + 1)):
            cellbox = box(c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL)
            inter = geom.intersection(cellbox)
            if not inter.is_empty and inter.area >= ratio * CELL * CELL:
                out.append([r, c])
    return out


def block_footprint(r, c, rng, scale=None):
    """格内生成体块轮廓：矩形（80%）或 L 形（20%）。外观卡通化，不追求真实。"""
    s = scale or rng.uniform(0.55, 0.85)
    w = CELL * s
    ox = c * CELL + (CELL - w) / 2 + rng.uniform(-4, 4)
    oy = r * CELL + (CELL - w) / 2 + rng.uniform(-4, 4)
    rect = [[ox, oy], [ox + w, oy], [ox + w, oy + w], [ox, oy + w], [ox, oy]]
    if rng.random() < 0.2:  # L 形：切去一角
        cut = w * rng.uniform(0.35, 0.5)
        rect = [[ox, oy], [ox + w, oy], [ox + w, oy + w - cut], [ox + w - cut, oy + w - cut],
                [ox + w - cut, oy + w], [ox, oy + w], [ox, oy]]
    return [[round(x, 1), round(y, 1)] for x, y in rect]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    buildings_raw = load("buildings") + load("landmarks_extra")
    network_raw = load("network")
    labels_raw = load("labels")
    if not buildings_raw:
        sys.exit("raw/buildings.json 缺失或为空")

    # ---- 1. 真实骨架：道路/水系/绿地 ----
    terrain = [["flat"] * GRID for _ in range(GRID)]
    water_polys, road_lines, forest_polys = [], [], []
    roads_out, water_out = [], []
    for el in network_raw:
        tags = el.get("tags", {})
        if el["type"] != "way":
            continue
        if "highway" in tags:
            if tags["highway"] in ("footway", "path", "cycleway", "steps", "pedestrian"):
                continue
            line = way_line(el)
            if line is None:
                continue
            road_lines.append(line)
            roads_out.append({"id": f"w{el['id']}", "kind": tags["highway"],
                              "name": tags.get("name:zh") or tags.get("name"),
                              "line": [[round(x, 1), round(y, 1)] for x, y in line.simplify(2.0).coords]})
        elif tags.get("waterway") or tags.get("natural") == "water":
            if tags.get("waterway") == "riverbank" or tags.get("natural") == "water":
                poly = way_polygon(el)
                if poly is not None:
                    water_polys.append(poly)
                    water_out.append({"id": f"w{el['id']}", "kind": "water_area",
                                      "name": tags.get("name:zh") or tags.get("name"),
                                      "footprint": [[round(x, 1), round(y, 1)] for x, y in poly.simplify(2.0).exterior.coords]})
            else:
                line = way_line(el)
                if line is not None:
                    width = 30.0 if tags.get("waterway") == "river" else 10.0
                    water_polys.append(line.buffer(width / 2))
                    water_out.append({"id": f"w{el['id']}", "kind": tags.get("waterway"),
                                      "name": tags.get("name:zh") or tags.get("name"),
                                      "line": [[round(x, 1), round(y, 1)] for x, y in line.simplify(2.0).coords]})
        elif tags.get("leisure") in ("park", "garden") or tags.get("landuse") in ("forest", "grass", "recreation_ground") or tags.get("natural") == "wood":
            poly = way_polygon(el)
            if poly is not None:
                forest_polys.append(poly)

    def paint(polys, value, ratio=0.3):
        for poly in polys:
            for r, c in cells_covered(poly, ratio):
                terrain[r][c] = value

    paint([l.buffer(6) for l in road_lines], "road_inherited", 0.15)
    paint(forest_polys, "forest", 0.4)
    paint(water_polys, "river", 0.2)
    for r in range(GRID):
        for c in range(GRID):
            if terrain[r][c] == "river":
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < GRID and 0 <= cc < GRID and terrain[rr][cc] == "flat":
                        terrain[rr][cc] = "bank"

    # ---- 2. 重点地标（真实轮廓）+ 功能建筑（名称保留，体块生成）----
    buildings = []
    reserved_cells = set()  # 地标与功能建筑占地，生成器避让
    landmarks_found, functional_count = [], 0
    zun_center = None
    for el in buildings_raw:
        eid = f"{el['type'][0]}{el['id']}"
        tags = el.get("tags", {})
        if "building" not in tags:
            continue
        poly = way_polygon(el) if el["type"] == "way" else relation_polygon(el)
        if poly is None:
            continue
        name = tags.get("name:zh") or tags.get("name")
        cells = cells_covered(poly)
        if not cells:
            continue
        cx, cy = poly.centroid.x, poly.centroid.y

        if eid in LANDMARK_IDS:
            mark, height = LANDMARK_IDS[eid]
            simple = poly.simplify(2.0, preserve_topology=True)
            geoms = [simple] if simple.geom_type == "Polygon" else list(simple.geoms)
            for g in geoms:
                buildings.append({
                    "id": eid, "name": name, "kind": "landmark", "landmark": mark,
                    "category": "cbd", "height_m": height,
                    "footprint": [[round(x, 1), round(y, 1)] for x, y in g.exterior.coords],
                    "cells": cells, "center": [round(cx, 1), round(cy, 1)],
                })
            landmarks_found.append(name)
            if mark == "zun":
                zun_center = (cx, cy)
            reserved_cells.update(map(tuple, cells))
            continue

        # 功能性建筑：具名或功能 amenity，保留名称/类别/高度，外观体块生成
        amenity = tags.get("amenity")
        is_functional = bool(name) or amenity in ("school", "hospital", "kindergarten", "university")
        if not is_functional:
            continue  # 普通真实轮廓丢弃，交给扩散生成
        btype = tags.get("building", "yes")
        category = CATEGORY_MAP.get(btype, "cbd" if parse_height(tags) >= 60 else "res_mid")
        if amenity in ("school", "kindergarten", "university"):
            category = "school"
        elif amenity == "hospital":
            category = "hospital"
        r0, c0 = cells[0]
        buildings.append({
            "id": eid, "name": name, "kind": "functional",
            "category": category, "height_m": round(parse_height(tags), 1),
            "osm_building": btype, "roof_shape": tags.get("roof:shape"),
            "footprint": block_footprint(r0, c0, rng, scale=0.8),
            "cells": cells, "center": [round(cx, 1), round(cy, 1)],
        })
        functional_count += 1
        reserved_cells.update(map(tuple, cells))

    # ---- 3. 普通建筑：扩散凝聚生成 ----
    if zun_center is None:
        zun_center = (1200.0, 1200.0)
    dist_road = [[999] * GRID for _ in range(GRID)]
    dq = deque()
    for r in range(GRID):
        for c in range(GRID):
            if terrain[r][c] == "road_inherited":
                dist_road[r][c] = 0
                dq.append((r, c))
    while dq:
        r, c = dq.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < GRID and 0 <= cc < GRID and dist_road[rr][cc] > dist_road[r][c] + 1:
                dist_road[rr][cc] = dist_road[r][c] + 1
                dq.append((rr, cc))

    candidates = [(r, c) for r in range(GRID) for c in range(GRID)
                  if terrain[r][c] == "flat" and (r, c) not in reserved_cells]
    n_generate = max(0, TARGET_OCCUPIED - len(reserved_cells))
    built = set(reserved_cells)

    def gen_category_height(r, c):
        cx, cy = c * CELL + 25, r * CELL + 25
        d_core = math.hypot(cx - zun_center[0], cy - zun_center[1])
        if d_core < 500:
            cat = rng.choices(["cbd", "shop", "res_high"], [0.55, 0.2, 0.25])[0]
            height = {"cbd": rng.uniform(60, 180), "shop": rng.uniform(12, 30),
                      "res_high": rng.uniform(45, 90)}[cat]
            if cat == "cbd" and rng.random() < 0.06:
                height = rng.uniform(180, 260)
        else:
            cat = rng.choices(["res_mid", "res_high", "cbd", "shop", "light_industry"],
                              [0.4, 0.3, 0.1, 0.15, 0.05])[0]
            height = {"res_mid": rng.uniform(18, 30), "res_high": rng.uniform(30, 70),
                      "cbd": rng.uniform(40, 100), "shop": rng.uniform(8, 20),
                      "light_industry": rng.uniform(7, 12)}[cat]
        return cat, round(height, 1)

    for i in range(n_generate):
        best, best_w = None, -1.0
        # 加权轮盘：道路衰减 × 邻接凝聚 × 核心密度
        weights = []
        for (r, c) in candidates:
            if (r, c) in built:
                weights.append(0.0)
                continue
            nb = sum((r + dr, c + dc) in built for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            cx, cy = c * CELL + 25, r * CELL + 25
            d_core = math.hypot(cx - zun_center[0], cy - zun_center[1])
            w = math.exp(-dist_road[r][c] / 2.5) * (1 + 0.8 * nb) * (1.6 if d_core < 500 else 1.0)
            weights.append(w)
        total = sum(weights)
        if total <= 0:
            break
        pick = rng.random() * total
        acc = 0.0
        for idx, w in enumerate(weights):
            acc += w
            if acc >= pick:
                best = candidates[idx]
                break
        if best is None:
            break
        r, c = best
        built.add(best)
        cat, height = gen_category_height(r, c)
        buildings.append({
            "id": f"gen{i:04d}", "name": None, "kind": "generated",
            "category": cat, "height_m": height,
            "footprint": block_footprint(r, c, rng),
            "cells": [[r, c]], "center": [c * CELL + 25, r * CELL + 25],
        })

    for (r, c) in built:
        if terrain[r][c] == "flat":
            terrain[r][c] = "occupied"

    # ---- 4. 地名（真实，功能建筑标出）----
    labels = []
    for el in labels_raw:
        tags = el.get("tags", {})
        name = tags.get("name:zh") or tags.get("name")
        if not name:
            continue
        if el["type"] == "node":
            x, y = local(el["lon"], el["lat"])
        else:
            center = el.get("center")
            if not center:
                continue
            x, y = local(center["lon"], center["lat"])
        importance = 2
        if "中国尊" in name or "中央电视台" in name:
            importance = 5
        elif tags.get("railway") == "station" or tags.get("station") == "subway":
            importance = 4
        elif tags.get("amenity") in ("school", "hospital", "university", "kindergarten"):
            importance = 3
        labels.append({"name": name, "name_en": tags.get("name:en"),
                       "kind": tags.get("amenity") or tags.get("railway") or tags.get("shop") or tags.get("tourism") or tags.get("office") or "poi",
                       "pos": [round(x, 1), round(y, 1)], "importance": importance})
    for b in buildings:
        if b["kind"] == "landmark":
            labels.append({"name": b["name"], "kind": "landmark", "pos": b["center"], "importance": 5})
        elif b["kind"] == "functional" and b["category"] in ("school", "hospital") and b["name"]:
            labels.append({"name": b["name"], "kind": b["category"], "pos": b["center"], "importance": 3})

    counts = {}
    for row in terrain:
        for t in row:
            counts[t] = counts.get(t, 0) + 1
    kind_counts = {}
    for b in buildings:
        kind_counts[b["kind"]] = kind_counts.get(b["kind"], 0) + 1

    parcel = {
        "parcel_id": "beijing_cbd", "display_name": "北京 · 朝阳 CBD–通惠河",
        "bbox_wgs84": BBOX,
        "crs": "EPSG:32650（局部原点为 bbox 西南角，单位米，x 东 y 北）",
        "grid": {"rows": GRID, "cols": GRID, "cell_m": CELL},
        "seed": SEED,
        "generation": "真实骨架（道路/水系/绿地/地名/地标）+ 功能建筑位置名称保留 + 普通建筑扩散凝聚生成（m00974 策略）",
        "terrain": terrain, "terrain_counts": counts,
        "buildings_url": "buildings.json", "network_url": "network.json", "labels_url": "labels.json",
        "license": "© OpenStreetMap contributors, ODbL 1.0（见 LICENSE.txt）",
    }
    (OUT / "parcel.json").write_text(json.dumps(parcel, ensure_ascii=False, separators=(",", ":")))
    (OUT / "buildings.json").write_text(json.dumps({"buildings": buildings}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "network.json").write_text(json.dumps({"roads": roads_out, "water": water_out}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "labels.json").write_text(json.dumps({"labels": labels}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "LICENSE.txt").write_text(
        "本数据包由 OpenStreetMap 数据加工而成（道路/水系/绿地/地名/重点地标轮廓为真实数据；\n"
        "功能性建筑保留真实位置与名称，外观为程序生成体块；普通建筑为扩散算法生成）。\n"
        "© OpenStreetMap contributors（https://www.openstreetmap.org/copyright）\n"
        "原始数据许可：Open Database License (ODbL) 1.0"
        "（https://opendatacommons.org/licenses/odbl/1-0/）\n"
        "本衍生数据包同样以 ODbL 1.0 共享。使用与再分发须保留本署名。\n"
        "数据来源：Overpass API（overpass-api.de / overpass.private.coffee），提取范围见 parcel.json。\n",
        encoding="utf-8")

    print(f"建筑 {len(buildings)} {kind_counts}（地标：{landmarks_found}）")
    print(f"道路 {len(roads_out)} | 水系 {len(water_out)} | 地名 {len(labels)}")
    print(f"地形统计 {counts}")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name}: {f.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
