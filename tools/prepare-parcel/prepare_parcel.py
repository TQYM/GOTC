#!/usr/bin/env python3
"""OSM JSON → CITY20 离线片区包。投影、裁剪、栅格化、简化、分片均在本进程完成。"""

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import polygonize, unary_union

DEFAULT_LEVELS = {
    "house": (1, 3.5), "hut": (1, 3.5),
    "apartments": (6, 3.0), "residential": (6, 3.0),
    "commercial": (3, 4.0), "retail": (3, 4.0),
    "office": (12, 3.5), "industrial": (1, 7.0), "warehouse": (1, 7.0),
}
LANDMARK_HEIGHTS = {
    "中国尊": 528.0, "中信大厦": 528.0, "CITIC Tower": 528.0,
    "中央电视台": 234.0, "央视": 234.0, "CCTV": 234.0,
    "国贸三期": 330.0, "China World Trade Center Tower III": 330.0,
}
ROAD_WIDTHS = {
    "motorway": 24, "trunk": 24, "primary": 20, "secondary": 16,
    "tertiary": 12, "residential": 10, "unclassified": 10, "service": 6,
}
SKIP_ROADS = {"footway", "cycleway", "path", "steps", "pedestrian", "construction"}


def number(value: Any) -> float | None:
    if value is None:
        return None
    match = re.search(r"\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else None


def height_and_levels(tags: dict[str, Any]) -> tuple[float, float, str]:
    name = str(tags.get("name", ""))
    for marker, height in LANDMARK_HEIGHTS.items():
        if marker.lower() in name.lower():
            return height, max(1.0, round(height / 3.5, 1)), "landmark-manual"
    height = number(tags.get("height"))
    levels = number(tags.get("building:levels"))
    category = str(tags.get("building", "yes"))
    default_levels, floor_height = DEFAULT_LEVELS.get(category, (2, 3.5))
    if height is not None and height > 0:
        return height, levels or max(1.0, height / floor_height), "osm-height"
    levels = levels or default_levels
    source = "osm-levels" if number(tags.get("building:levels")) else "default-levels"
    return levels * floor_height, levels, source


def category_of(tags: dict[str, Any]) -> str:
    building = str(tags.get("building", "yes"))
    if building in ("apartments", "residential", "house", "hut", "dormitory"):
        return "residential"
    if building in ("office", "commercial", "retail", "hotel"):
        return "workplace"
    if building in ("industrial", "warehouse"):
        return "industrial"
    return "civic"


def local_geometry(element: dict[str, Any], project, polygon: bool) -> BaseGeometry | None:
    if element.get("type") == "way":
        coords = [project(node["lon"], node["lat"]) for node in element.get("geometry", [])]
        if len(coords) < 2:
            return None
        if polygon and len(coords) >= 4 and coords[0] == coords[-1]:
            return Polygon(coords)
        return LineString(coords)
    if element.get("type") == "relation" and polygon:
        lines = []
        for member in element.get("members", []):
            if member.get("type") != "way" or member.get("role") not in ("", "outer"):
                continue
            coords = [project(node["lon"], node["lat"]) for node in member.get("geometry", [])]
            if len(coords) >= 2:
                lines.append(LineString(coords))
        if not lines:
            return None
        polygons = list(polygonize(unary_union(lines)))
        return unary_union(polygons) if polygons else None
    return None


def cells_for_geometry(geom: BaseGeometry, size: int, cell_size: int) -> list[list[int]]:
    if geom.is_empty:
        return []
    minx, miny, maxx, maxy = geom.bounds
    c0 = max(0, int(minx // cell_size))
    c1 = min(size - 1, int(maxx // cell_size))
    # r=0 在北边；本地 y 轴向北。
    r0 = max(0, size - 1 - int(maxy // cell_size))
    r1 = min(size - 1, size - 1 - int(miny // cell_size))
    cells = []
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            tile = box(c * cell_size, (size - 1 - r) * cell_size,
                       (c + 1) * cell_size, (size - r) * cell_size)
            intersection = geom.intersection(tile)
            if intersection.is_empty:
                continue
            if geom.covers(tile.representative_point()) or intersection.area >= tile.area * 0.08:
                cells.append([r, c])
    if not cells:
        point = geom.representative_point()
        c = min(size - 1, max(0, int(point.x // cell_size)))
        r = min(size - 1, max(0, size - 1 - int(point.y // cell_size)))
        cells = [[r, c]]
    return sorted(cells)


def rounded_path(coords, digits=1) -> list[list[float]]:
    return [[round(float(x), digits), round(float(y), digits)] for x, y in coords]


def write_json(path: Path, payload: Any) -> int:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return path.stat().st_size


def prepare(input_path: Path, output_dir: Path, config: dict[str, Any]) -> dict[str, Any]:
    raw_bytes = input_path.read_bytes()
    raw = json.loads(raw_bytes)
    west, south, east, north = config["bbox"]
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:32650", always_xy=True)
    corners = [transformer.transform(lon, lat) for lon, lat in
               ((west, south), (west, north), (east, south), (east, north))]
    center_x = (min(p[0] for p in corners) + max(p[0] for p in corners)) / 2
    center_y = (min(p[1] for p in corners) + max(p[1] for p in corners)) / 2
    size, cell_size = config["size"], config["cell_size_m"]
    origin_x, origin_y = center_x - size * cell_size / 2, center_y - size * cell_size / 2

    def project(lon, lat):
        x, y = transformer.transform(lon, lat)
        return x - origin_x, y - origin_y

    grid = box(0, 0, size * cell_size, size * cell_size)
    terrain = [["flat" for _ in range(size)] for _ in range(size)]
    forests, waters, roads, buildings, networks = [], [], [], [], []
    stats = defaultdict(int)

    for element in raw.get("elements", []):
        tags = element.get("tags", {})
        kind = element.get("type")
        if kind == "node" and tags.get("railway") == "station":
            x, y = project(element["lon"], element["lat"])
            if grid.covers(Point(x, y)):
                networks.append({
                    "feature_id": f"osm-node-{element['id']}", "kind": "subway_station",
                    "highway": None, "path": [[round(x, 1), round(y, 1)]],
                })
            continue
        is_building = bool(tags.get("building"))
        is_water = tags.get("natural") == "water" or bool(tags.get("waterway"))
        is_forest = tags.get("landuse") == "forest" or tags.get("leisure") == "park"
        polygon = is_building or is_water or is_forest
        geom = local_geometry(element, project, polygon)
        if geom is None or geom.is_empty:
            stats["skipped_geometry"] += 1
            continue
        geom = geom.intersection(grid)
        if geom.is_empty:
            stats["outside_bbox"] += 1
            continue
        if is_building:
            buildings.append((element, geom.simplify(2.0, preserve_topology=True)))
        elif is_water:
            waters.append(geom)
        elif is_forest:
            forests.append(geom)
        elif tags.get("highway") and tags["highway"] not in SKIP_ROADS:
            roads.append((element, geom))
        elif tags.get("railway"):
            networks.append((element, geom))

    # 低优先级先写；建筑最后覆盖，严格执行 occupied > road > water > green > flat。
    for geom in forests:
        for r, c in cells_for_geometry(geom, size, cell_size):
            terrain[r][c] = "forest"
    water_union = unary_union(waters) if waters else None
    if water_union is not None:
        bank = water_union.buffer(config["green_line_m"]).difference(water_union)
        for r, c in cells_for_geometry(bank, size, cell_size):
            terrain[r][c] = "bank"
        for r, c in cells_for_geometry(water_union, size, cell_size):
            terrain[r][c] = "river"

    inherited_road: set[tuple[int, int]] = set()
    for element, geom in roads:
        highway = str(element["tags"]["highway"])
        width = number(element["tags"].get("width")) or ROAD_WIDTHS.get(highway, 8)
        for r, c in cells_for_geometry(geom.buffer(width / 2), size, cell_size):
            terrain[r][c] = "road_inherited"
            inherited_road.add((r, c))
        simplified = geom.simplify(2.0, preserve_topology=True)
        if simplified.geom_type == "LineString" and len(simplified.coords) >= 2:
            networks.append({
                "feature_id": f"osm-way-{element['id']}", "kind": "road", "highway": highway,
                "path": rounded_path(simplified.coords),
            })

    chunks: dict[str, list[dict[str, Any]]] = defaultdict(list)
    height_sources = defaultdict(int)
    polygon_buildings = []
    for element, geom in buildings:
        parts = [geom] if geom.geom_type == "Polygon" else getattr(geom, "geoms", [])
        polygon_buildings.extend(
            (element, part, index if len(parts) > 1 else None)
            for index, part in enumerate(parts)
            if part.geom_type == "Polygon" and not part.is_empty
        )
    for element, geom, part_index in polygon_buildings:
        tags = element.get("tags", {})
        cells = cells_for_geometry(geom, size, cell_size)
        for r, c in cells:
            terrain[r][c] = "occupied"
        height, levels, height_source = height_and_levels(tags)
        height_sources[height_source] += 1
        category = category_of(tags)
        area = geom.area
        floor_area = area * levels
        population = (
            round(floor_area / config["residential_m2_per_person"])
            if category == "residential" else 0
        )
        jobs_per_m2 = (
            config["industrial_m2_per_job"]
            if category == "industrial" else config["workplace_m2_per_job"]
        )
        jobs = (
            round(floor_area / jobs_per_m2)
            if category in ("workplace", "industrial") else 0
        )
        asset_id = f"osm-{element['type']}-{element['id']}"
        if part_index is not None:
            asset_id += f"-part-{part_index}"
        asset = {
            "asset_id": asset_id,
            "name": tags.get("name"), "category": category,
            "height_m": round(height, 1), "levels": round(levels, 1),
            "footprint": rounded_path(geom.exterior.coords),
            "cells": cells, "base_area_m2": round(area, 1),
            "population": population, "jobs": jobs,
            "demolition_cost": round(floor_area * config["demolition_yuan_per_m2"]),
            "upkeep": round(floor_area * config["existing_upkeep_yuan_per_m2"]),
            "height_source": height_source,
        }
        r, c = cells[0]
        chunks[f"{r // 8}:{c // 8}"].append(asset)

    final_networks = [item for item in networks if isinstance(item, dict) and "path" in item]
    for element, geom in (item for item in networks if isinstance(item, tuple)):
        simplified = geom.simplify(2.0, preserve_topology=True)
        if simplified.geom_type == "LineString" and len(simplified.coords) >= 2:
            final_networks.append({
                "feature_id": f"osm-{element['type']}-{element['id']}",
                "kind": "subway" if element["tags"].get("railway") == "subway" else "rail",
                "highway": None, "path": rounded_path(simplified.coords),
            })

    buildable = sum(cell in ("flat", "forest") for row in terrain for cell in row)
    config_bytes = json.dumps(config, ensure_ascii=False, sort_keys=True).encode()
    data_version = "osm-" + hashlib.sha256(raw_bytes + config_bytes).hexdigest()[:12]
    parcel = {
        "parcel_id": "beijing_cbd", "district_name": config["district_name"],
        "data_version": data_version, "size": size, "cell_size_m": cell_size,
        "crs": "EPSG:32650", "origin": [round(origin_x, 2), round(origin_y, 2)],
        "bbox": config["bbox"], "terrain": terrain,
        "inherited_road": [list(cell) for cell in sorted(inherited_road)],
        "constraints": {
            "height_limit_m": config["height_limit_m"], "green_line_m": config["green_line_m"],
            "buildable_ratio": round(buildable / (size * size), 4),
            "briefing": {
                "text": (
                    "这里是朝阳 CBD–通惠河核心区。occupied 为现状建筑，需先更新改造；"
                    "道路与水域不可直接覆盖。数据 © OpenStreetMap contributors，ODbL 1.0。"
                ),
                "source": "template",
            },
        },
        "seed": config["seed"],
        "buildings_url": "/static/parcels/beijing_cbd/buildings.json",
        "network_url": "/static/parcels/beijing_cbd/network.json",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    sizes = {
        "parcel.json": write_json(output_dir / "parcel.json", parcel),
        "buildings.json": write_json(output_dir / "buildings.json", {
            "parcel_id": "beijing_cbd", "data_version": data_version,
            "chunks": {key: chunks[key] for key in sorted(chunks)},
        }),
        "network.json": write_json(output_dir / "network.json", {
            "parcel_id": "beijing_cbd", "data_version": data_version, "features": final_networks,
        }),
    }
    stats.update({
        "raw_elements": len(raw.get("elements", [])),
        "buildings": sum(len(items) for items in chunks.values()),
        "occupied_cells": sum(cell == "occupied" for row in terrain for cell in row),
        "road_cells": len(inherited_road),
        "river_cells": sum(cell == "river" for row in terrain for cell in row),
        "forest_cells": sum(cell == "forest" for row in terrain for cell in row),
        "network_features": len(final_networks), "height_sources": dict(height_sources),
        "population": sum(asset["population"] for items in chunks.values() for asset in items),
        "jobs": sum(asset["jobs"] for items in chunks.values() for asset in items),
        "upkeep": sum(asset["upkeep"] for items in chunks.values() for asset in items),
    })
    source = {
        "source": "© OpenStreetMap contributors", "license": "ODbL-1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "raw_sha256": hashlib.sha256(raw_bytes).hexdigest(), "bbox": config["bbox"],
        "crs": "EPSG:32650", "origin": parcel["origin"], "grid": [size, cell_size],
        "simplification_tolerance_m": 2, "stats": stats, "bytes": sizes,
    }
    write_json(output_dir / "source.json", source)
    return source


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--parcel", default="beijing_cbd")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("parcels.yaml"))
    args = parser.parse_args()
    config = yaml.safe_load(args.config.read_text("utf-8"))[args.parcel]
    source = prepare(args.input, args.output, config)
    print(json.dumps(source["stats"], ensure_ascii=False, indent=2))
    print(json.dumps(source["bytes"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
