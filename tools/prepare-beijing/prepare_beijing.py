#!/usr/bin/env python3
"""CITY20 全域北京数据包管线（m01155）。

策略：
- 城四区（东城/西城/朝阳/海淀）真实骨架；全域道路/水系/公园/地名真实
- 其余区域扩散 + fBm 噪声生成；城区→乡村用连续 urbanity 场渐变融合
- 重点地标真实轮廓；功能建筑（具名/学校/医院）位置名称保留、体块生成
- 山区（西山/燕山/军都山）噪声地形隆起；乡村围绕真实 village 点聚落

输入：tools/prepare-beijing/raw/*.json（fetch.py 产物）
输出：data/parcels/beijing_full/{parcel,buildings,network,labels}.json + LICENSE.txt
网格：200m/格（全域约 154×189km）；游戏精细片区仍为 beijing_cbd（50m）。
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
RAW = ROOT / "tools/prepare-beijing/raw"
OUT = ROOT / "data/parcels/beijing_full"

BBOX = {"south": 39.40, "west": 115.60, "north": 41.10, "east": 117.50}
CORE = {"south": 39.75, "west": 116.10, "north": 40.10, "east": 116.66}  # 东西朝海
CELL = 200.0
SEED = 20261107

TF = Transformer.from_crs("EPSG:4326", "EPSG:32650", always_xy=True)
OX, OY = TF.transform(BBOX["west"], BBOX["south"])
EX, EY = TF.transform(BBOX["east"], BBOX["north"])
W = int((EX - OX) / CELL) + 1
H = int((EY - OY) / CELL) + 1

# 地标：名称关键词 → (识别件, 高度m)
LANDMARK_RULES = [
    ("中国尊", "zun", 528.0), ("中信大厦", "zun", 528.0),
    ("中央电视台总部大楼", "cctv", 234.0),
    ("故宫", "gugong", 18.0), ("天安门", "tiananmen", 35.0),
    ("国家体育场", "niaochao", 69.0), ("鸟巢", "niaochao", 69.0),
    ("水立方", "watercube", 30.0), ("国家游泳中心", "watercube", 30.0),
]
# 含这些词的一律不是地标本体（道路/门外/广场/训练场等会被名称子串误匹配）
LANDMARK_EXCLUDE = ("路", "街", "门外", "广场", "训练场", "北院区", "停车场", "地铁", "桥",
                    "安检", "红墙", "绿地")
CATEGORY_MAP = {
    "house": "res_low", "detached": "res_low", "residential": "res_mid",
    "dormitory": "res_mid", "apartments": "res_high", "office": "cbd",
    "commercial": "shop", "retail": "shop", "supermarket": "shop",
    "industrial": "light_industry", "warehouse": "light_industry",
    "school": "school", "university": "school", "kindergarten": "school",
    "hospital": "hospital", "hotel": "cbd",
}
HEIGHT_FALLBACK = {"office": 60.0, "hotel": 70.0, "school": 15.0, "hospital": 24.0,
                   "apartments": 25.0, "residential": 20.0, "commercial": 20.0, "yes": 24.0}


def local(lon, lat):
    x, y = TF.transform(lon, lat)
    return (x - OX, y - OY)


def load(name):
    p = RAW / f"{name}.json"
    return json.loads(p.read_text()).get("elements", []) if p.exists() else []


def load_many(prefix):
    els = []
    for p in sorted(RAW.glob(f"{prefix}_*.json")):
        els.extend(json.loads(p.read_text()).get("elements", []))
    return els


def way_polygon(el):
    geom = el.get("geometry") or []
    if len(geom) < 4:
        return None
    pts = [local(g["lon"], g["lat"]) for g in geom]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)  # 自相交轮廓修复（可能返回 MultiPolygon）
    return poly if (not poly.is_empty) and poly.area > 10 else None


def relation_polygon(el):
    outers = [way_polygon(m) for m in el.get("members", [])
              if m.get("type") == "way" and m.get("role") in ("outer", "")]
    outers = [p for p in outers if p is not None]
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
        return max(3.5, int(lv) * (4.0 if tags.get("building") in ("office", "hotel") else 3.5))
    return HEIGHT_FALLBACK.get(tags.get("building", "yes"), 24.0)


def cell_of(x, y):
    c, r = int(x // CELL), int(y // CELL)
    return (r, c) if 0 <= r < H and 0 <= c < W else None


def cells_covered(geom, ratio=0.3):
    out = []
    minx, miny, maxx, maxy = geom.bounds
    for r in range(max(0, int(miny // CELL)), min(H, int(maxy // CELL) + 1)):
        for c in range(max(0, int(minx // CELL)), min(W, int(maxx // CELL) + 1)):
            cb = box(c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL)
            inter = geom.intersection(cb)
            if not inter.is_empty and inter.area >= ratio * CELL * CELL:
                out.append([r, c])
    return out


# ---- 2D value noise + fBm（无外部依赖）----
def _hash2(ix, iy):
    n = (ix * 374761393 + iy * 668265263 + SEED) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash2(ix, iy), _hash2(ix + 1, iy)
    c, d = _hash2(ix, iy + 1), _hash2(ix + 1, iy + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def fbm(x, y, octaves=4):
    v, amp, freq, total = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        v += vnoise(x * freq, y * freq) * amp
        total += amp
        amp *= 0.5
        freq *= 2.03
    return v / total


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def main():
    def has_any(prefix):
        return any(RAW.glob(f"{prefix}*.json"))
    if not (has_any("water") and has_any("roads_major")):
        sys.exit("raw 数据未就绪，先跑 fetch.py")
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    print(f"网格 {W}×{H} @200m", flush=True)

    # ---- 真实元素收集 ----
    roads_out, water_out = [], []
    road_lines, water_polys, park_polys = [], [], []
    for el in load_many("roads_major") + load_many("roads_minor"):
        if el["type"] != "way":
            continue
        tags = el.get("tags", {})
        line = way_line(el)
        if line is None:
            continue
        road_lines.append((tags["highway"], line))
        roads_out.append({"id": f"w{el['id']}", "kind": tags["highway"],
                          "name": tags.get("name:zh") or tags.get("name"),
                          "line": [[round(x, 1), round(y, 1)] for x, y in line.simplify(8.0).coords]})
    for el in load("water") + load_many("water"):
        if el["type"] != "way":
            continue
        tags = el.get("tags", {})
        if tags.get("waterway") == "riverbank" or tags.get("natural") == "water":
            poly = way_polygon(el)
            if poly is not None:
                water_polys.append(poly)
                water_out.append({"id": f"w{el['id']}", "kind": "water_area",
                                  "name": tags.get("name:zh") or tags.get("name"),
                                  "footprint": [[round(x, 1), round(y, 1)] for x, y in poly.simplify(8.0).exterior.coords]})
        else:
            line = way_line(el)
            if line is not None:
                width = 40.0 if tags.get("waterway") == "river" else 12.0
                water_polys.append(line.buffer(width / 2))
                water_out.append({"id": f"w{el['id']}", "kind": tags.get("waterway"),
                                  "name": tags.get("name:zh") or tags.get("name"),
                                  "line": [[round(x, 1), round(y, 1)] for x, y in line.simplify(8.0).coords]})
    for el in load("parks") + load_many("parks"):
        if el["type"] == "way":
            poly = way_polygon(el)
            if poly is not None:
                park_polys.append(poly)

    # ---- 地名（真实），村庄点用于乡村聚落 ----
    labels, villages, towns = [], [], []
    for el in (load("labels_transit_edu") + load("labels_places")
               + load("labels_place_only") + load("labels_tourism_peak")):
        tags = el.get("tags", {})
        name = tags.get("name:zh") or tags.get("name")
        if not name:
            continue
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            center = el.get("center") or {}
            lon, lat = center.get("lon"), center.get("lat")
        if lon is None:
            continue
        x, y = local(lon, lat)
        if not (0 <= x < W * CELL and 0 <= y < H * CELL):
            continue
        place = tags.get("place")
        kind = place or tags.get("amenity") or tags.get("railway") or tags.get("tourism") or tags.get("natural") or "poi"
        importance = 2
        if place in ("town", "suburb"):
            importance = 4
            towns.append((name, x, y))
        elif place == "village":
            importance = 2
            villages.append((name, x, y))
        elif tags.get("railway") == "station":
            importance = 4
        elif tags.get("amenity") in ("school", "hospital", "university"):
            importance = 3
        elif tags.get("tourism") == "attraction":
            importance = 3
        labels.append({"name": name, "kind": kind, "pos": [round(x, 1), round(y, 1)],
                       "importance": importance})
    print(f"道路 {len(roads_out)} 水系 {len(water_out)} 公园 {len(park_polys)} 地名 {len(labels)}（村庄 {len(villages)} 城镇 {len(towns)}）", flush=True)

    # ---- 核心/城镇 urbanity 场 ----
    core_x0, core_y0 = local(CORE["west"], CORE["south"])
    core_x1, core_y1 = local(CORE["east"], CORE["north"])
    urban_seeds = [(x, y, 1.0, 24000.0) for x, y in
                   [((core_x0 + core_x1) / 2, (core_y0 + core_y1) / 2)]]
    # 近郊中心：真实城镇点（通州/昌平/顺义/大兴/房山/门头沟/怀柔/密云/平谷/延庆等）
    for name, x, y in towns:
        urban_seeds.append((x, y, 0.75, 7000.0))
    zun_x, zun_y = local(116.4616, 39.9095)  # 中国尊近似中心（CBD 密度加成）

    # urbanity 栅格预计算：seed 只扫自身半径格（避免 73 万格 × N 点的全表扫描）
    urb = [[0.0] * W for _ in range(H)]
    for sx, sy, amp, radius in urban_seeds:
        c0 = max(0, int((sx - radius) // CELL))
        c1 = min(W - 1, int((sx + radius) // CELL))
        r0 = max(0, int((sy - radius) // CELL))
        r1 = min(H - 1, int((sy + radius) // CELL))
        for r in range(r0, r1 + 1):
            y = r * CELL + CELL / 2
            for c in range(c0, c1 + 1):
                x = c * CELL + CELL / 2
                d = math.hypot(x - sx, y - sy)
                if d < radius:
                    u = amp * (1 - smoothstep(radius * 0.35, radius, d))
                    if u > urb[r][c]:
                        urb[r][c] = u

    # 山地经纬度阈值 → 局部坐标（避免每格调 pyproj 反投影）
    x_west_1 = local(116.10, 40.0)[0]
    x_west_2 = local(116.42, 40.0)[0]
    y_north_1 = local(116.6, 40.10)[1]
    y_north_2 = local(116.6, 40.45)[1]

    def mountain(x, y):
        # 西部西山 + 北部燕山/军都山；噪声扰动边界
        m = max(1 - smoothstep(x_west_1, x_west_2, x),
                smoothstep(y_north_1, y_north_2, y))
        m += (fbm(x / 6000, y / 6000, 3) - 0.5) * 0.5
        return max(0.0, min(1.0, m))

    # ---- 地形 + 高程 ----
    terrain = [["flat"] * W for _ in range(H)]
    elevation = [[0] * W for _ in range(H)]
    for r in range(H):
        y = r * CELL + CELL / 2
        for c in range(W):
            x = c * CELL + CELL / 2
            m = mountain(x, y)
            # 噪声让城乡边界犬牙交错，山地压制城市
            u = max(0.0, min(1.0, urb[r][c] + (fbm(x / 3500, y / 3500, 3) - 0.5) * 0.35)) * (1 - m)
            urb[r][c] = u
            if m > 0.25:
                elevation[r][c] = int(m * (250 + fbm(x / 2500, y / 2500, 4) * 1300))
                terrain[r][c] = "forest" if fbm(x / 1800, y / 1800, 3) > 0.35 else "hill"
            else:
                n = fbm(x / 2800 + 100, y / 2800, 3)
                if u < 0.3:
                    terrain[r][c] = "farmland" if n > 0.42 else ("forest" if n < 0.2 else "flat")
                elif u < 0.55:
                    terrain[r][c] = "flat" if n > 0.3 else "farmland"
        if r % 150 == 0:
            print(f"地形 {r}/{H}", flush=True)

    def paint(polys, value, ratio=0.3):
        for poly in polys:
            for r, c in cells_covered(poly, ratio):
                terrain[r][c] = value
                elevation[r][c] = min(elevation[r][c], 60)

    paint([l.buffer(9) for _, l in road_lines], "road_inherited", 0.08)
    paint(park_polys, "forest", 0.35)
    paint(water_polys, "river", 0.15)
    for r in range(H):
        for c in range(W):
            if terrain[r][c] == "river":
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < H and 0 <= cc < W and terrain[rr][cc] in ("flat", "farmland"):
                        terrain[rr][cc] = "bank"

    # ---- 距道路 BFS（生成用，限制深度 12 格=2.4km）----
    dist_road = [[99] * W for _ in range(H)]
    dq = deque()
    for r in range(H):
        for c in range(W):
            if terrain[r][c] == "road_inherited":
                dist_road[r][c] = 0
                dq.append((r, c))
    while dq:
        r, c = dq.popleft()
        if dist_road[r][c] >= 12:
            continue
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W and dist_road[rr][cc] > dist_road[r][c] + 1:
                dist_road[rr][cc] = dist_road[r][c] + 1
                dq.append((rr, cc))

    # ---- 建筑：地标真实 + 功能具名 + 全域扩散生成 ----
    buildings = []
    reserved = set()

    def block_footprint(r, c, scale, jitter=15):
        w = CELL * scale
        ox = c * CELL + (CELL - w) / 2 + rng.uniform(-jitter, jitter)
        oy = r * CELL + (CELL - w) / 2 + rng.uniform(-jitter, jitter)
        return [[round(ox, 1), round(oy, 1)], [round(ox + w, 1), round(oy, 1)],
                [round(ox + w, 1), round(oy + w, 1)], [round(ox, 1), round(oy + w, 1)],
                [round(ox, 1), round(oy, 1)]]

    def landmark_of(name):
        if any(x in name for x in LANDMARK_EXCLUDE):
            return None, None
        for key, mark, h in LANDMARK_RULES:
            if key in name:
                return mark, h
        return None, None

    # 地标 + 具名功能建筑（真实位置名称）
    named_els = load_many("buildings_named") + load("landmarks")
    seen = set()
    seen_landmark_names = set()
    for el in named_els:
        eid = f"{el['type'][0]}{el['id']}"
        if eid in seen:
            continue
        seen.add(eid)
        tags = el.get("tags", {})
        name = tags.get("name:zh") or tags.get("name")
        if not name or "building" not in tags:
            # 地标查询里可能带非建筑 way（如天安门广场），仍保留为地标
            mark, _ = landmark_of(name)
            if not mark:
                continue
        poly = way_polygon(el) if el["type"] == "way" else relation_polygon(el)
        if poly is None:
            continue
        cx, cy = poly.centroid.x, poly.centroid.y
        cells = cells_covered(poly)
        if not cells:
            # 小轮廓在 200m 格下达不到 30% 面积阈值 → 用中心格兜底，不丢建筑
            center_cell = cell_of(cx, cy)
            if not center_cell:
                continue
            cells = [list(center_cell)]
        mark, lh = landmark_of(name)
        if mark:
            simple = poly.simplify(4.0, preserve_topology=True)
            geoms = [simple] if simple.geom_type == "Polygon" else list(simple.geoms)
            for g in geoms:
                buildings.append({"id": eid, "name": name, "kind": "landmark", "landmark": mark,
                                  "category": "landmark", "height_m": lh,
                                  "footprint": [[round(x, 1), round(y, 1)] for x, y in g.exterior.coords],
                                  "cells": cells, "center": [round(cx, 1), round(cy, 1)]})
            if name not in seen_landmark_names:
                seen_landmark_names.add(name)
                labels.append({"name": name, "kind": "landmark", "pos": [round(cx, 1), round(cy, 1)], "importance": 5})
        else:
            btype = tags.get("building", "yes")
            cat = CATEGORY_MAP.get(btype, "cbd" if parse_height(tags) >= 60 else "res_mid")
            r0, c0 = cells[0]
            buildings.append({"id": eid, "name": name, "kind": "functional", "category": cat,
                              "height_m": round(parse_height(tags), 1),
                              "footprint": block_footprint(r0, c0, 0.7),
                              "cells": cells, "center": [round(cx, 1), round(cy, 1)]})
        reserved.update(map(tuple, cells))
    n_functional = sum(1 for b in buildings if b["kind"] == "functional")
    n_landmark = sum(1 for b in buildings if b["kind"] == "landmark")
    print(f"地标 {n_landmark} 功能建筑 {n_functional}", flush=True)

    # 城市+近郊扩散生成：urbanity 控制密度/高度/类别
    n_urban = 0
    for r in range(H):
        for c in range(W):
            if terrain[r][c] not in ("flat", "farmland") or (r, c) in reserved:
                continue
            u = urb[r][c]
            if u < 0.25 or dist_road[r][c] > 10:
                continue
            prob = (u ** 1.6) * 0.9 * math.exp(-dist_road[r][c] / 6.0)
            if rng.random() > prob:
                continue
            x, y = c * CELL + 100, r * CELL + 100
            d_core = math.hypot(x - zun_x, y - zun_y)
            if u > 0.75:
                if d_core < 2600:
                    cat = rng.choices(["cbd", "shop", "res_high"], [0.5, 0.2, 0.3])[0]
                    h = {"cbd": rng.uniform(60, 170), "shop": rng.uniform(15, 35), "res_high": rng.uniform(50, 100)}[cat]
                    if cat == "cbd" and rng.random() < 0.05:
                        h = rng.uniform(170, 280)
                else:
                    cat = rng.choices(["res_high", "res_mid", "shop", "cbd"], [0.4, 0.3, 0.2, 0.1])[0]
                    h = {"res_high": rng.uniform(35, 80), "res_mid": rng.uniform(18, 35),
                         "shop": rng.uniform(10, 25), "cbd": rng.uniform(40, 110)}[cat]
            elif u > 0.45:
                cat = rng.choices(["res_mid", "res_low", "shop", "light_industry"], [0.45, 0.3, 0.1, 0.15])[0]
                h = {"res_mid": rng.uniform(15, 28), "res_low": rng.uniform(7, 12),
                     "shop": rng.uniform(7, 15), "light_industry": rng.uniform(8, 14)}[cat]
            else:
                cat = rng.choices(["res_low", "res_mid", "light_industry"], [0.65, 0.2, 0.15])[0]
                h = {"res_low": rng.uniform(5, 10), "res_mid": rng.uniform(12, 20),
                     "light_industry": rng.uniform(7, 12)}[cat]
            buildings.append({"id": f"gen{n_urban:05d}", "name": None, "kind": "generated",
                              "settlement": "urban", "category": cat, "height_m": round(h, 1),
                              "footprint": block_footprint(r, c, rng.uniform(0.45, 0.7)),
                              "cells": [[r, c]], "center": [x, y]})
            reserved.add((r, c))
            n_urban += 1
        if r % 200 == 0:
            print(f"城市生成 {r}/{H}（已 {n_urban}）", flush=True)

    # 乡村聚落：围绕真实村庄点小聚集
    n_rural = 0
    for name, x, y in villages:
        cell = cell_of(x, y)
        if not cell:
            continue
        r0, c0 = cell
        if mountain(x, y) > 0.7:
            size = rng.randint(2, 6)
        else:
            size = rng.randint(4, 14)
        placed = 0
        for _ in range(size * 4):
            if placed >= size:
                break
            r = r0 + rng.randint(-2, 2)
            c = c0 + rng.randint(-2, 2)
            if not (0 <= r < H and 0 <= c < W) or (r, c) in reserved:
                continue
            if terrain[r][c] not in ("flat", "farmland"):
                continue  # 乡村不限距主干道（村道未拉取，村庄点即聚落锚）
            buildings.append({"id": f"vil{n_rural:05d}", "name": None, "kind": "generated",
                              "settlement": "rural", "category": "res_low",
                              "height_m": round(rng.uniform(4, 9), 1),
                              "footprint": block_footprint(r, c, rng.uniform(0.2, 0.4)),
                              "cells": [[r, c]], "center": [c * CELL + 100, r * CELL + 100]})
            reserved.add((r, c))
            placed += 1
            n_rural += 1

    for (r, c) in reserved:
        if terrain[r][c] not in ("river", "road_inherited"):
            terrain[r][c] = "occupied"

    counts = {}
    for row in terrain:
        for t in row:
            counts[t] = counts.get(t, 0) + 1

    parcel = {
        "parcel_id": "beijing_full", "display_name": "北京 · 全域",
        "bbox_wgs84": BBOX, "core_bbox_wgs84": CORE,
        "crs": "EPSG:32650（局部原点为 bbox 西南角，单位米，x 东 y 北）",
        "grid": {"rows": H, "cols": W, "cell_m": CELL},
        "seed": SEED,
        "generation": "城四区真实骨架+全域真实道路/水系/公园/地名；其余扩散+fBm噪声；urbanity连续场城乡融合（m01155）",
        "terrain": terrain, "elevation": elevation, "terrain_counts": counts,
        "buildings_url": "buildings.json", "network_url": "network.json", "labels_url": "labels.json",
        "license": "© OpenStreetMap contributors, ODbL 1.0（见 LICENSE.txt）",
    }
    (OUT / "parcel.json").write_text(json.dumps(parcel, ensure_ascii=False, separators=(",", ":")))
    (OUT / "buildings.json").write_text(json.dumps({"buildings": buildings}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "network.json").write_text(json.dumps({"roads": roads_out, "water": water_out}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "labels.json").write_text(json.dumps({"labels": labels}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "LICENSE.txt").write_text(
        "本数据包由 OpenStreetMap 数据加工 + 程序生成混合而成。\n"
        "真实：道路/水系/公园/地名/重点地标轮廓/具名建筑位置名称。\n"
        "生成：普通建筑（扩散+噪声）、山地高程、城乡过渡（urbanity 场）。\n"
        "© OpenStreetMap contributors（https://www.openstreetmap.org/copyright）\n"
        "ODbL 1.0（https://opendatacommons.org/licenses/odbl/1-0/），衍生数据同许可共享，再分发须署名。\n",
        encoding="utf-8")

    kinds = {}
    for b in buildings:
        k = b["kind"] + ("/" + b.get("settlement", "") if b["kind"] == "generated" else "")
        kinds[k] = kinds.get(k, 0) + 1
    print(f"建筑 {len(buildings)} {kinds}")
    print(f"地形统计 {counts}")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name}: {f.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
