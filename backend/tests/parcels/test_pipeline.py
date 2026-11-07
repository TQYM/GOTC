"""PR-27：离线 GIS 管线与真实 beijing_cbd 数据包验收。"""

import importlib.util
import json
from pathlib import Path

import yaml

from app.config import load_sim_config
from app.contracts.asset import BuildingsFile, NetworkFile
from app.contracts.parcel import Parcel
from app.sim.parcel_loader import load_parcel

ROOT = Path(__file__).resolve().parents[3]
TOOL_PATH = ROOT / "tools" / "prepare-parcel" / "prepare_parcel.py"
SPEC = importlib.util.spec_from_file_location("prepare_parcel", TOOL_PATH)
assert SPEC and SPEC.loader
PIPELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PIPELINE)


def synthetic_raw() -> dict:
    west, south, east, north = 116.437, 39.900, 116.465, 39.9216
    lon, lat = (west + east) / 2, (south + north) / 2
    square = [
        {"lon": lon - 0.0002, "lat": lat - 0.0002},
        {"lon": lon - 0.0002, "lat": lat + 0.0002},
        {"lon": lon + 0.0002, "lat": lat + 0.0002},
        {"lon": lon + 0.0002, "lat": lat - 0.0002},
        {"lon": lon - 0.0002, "lat": lat - 0.0002},
    ]
    return {
        "elements": [
            {
                "type": "way", "id": 1,
                "tags": {"building": "apartments", "building:levels": "8"},
                "geometry": square,
            },
            {"type": "way", "id": 2, "tags": {"highway": "primary"}, "geometry": [
                {"lon": lon - 0.001, "lat": lat}, {"lon": lon + 0.001, "lat": lat}
            ]},
            {"type": "way", "id": 3, "tags": {"natural": "water"}, "geometry": [
                {"lon": west + 0.001, "lat": south + 0.001},
                {"lon": west + 0.001, "lat": south + 0.002},
                {"lon": west + 0.002, "lat": south + 0.002},
                {"lon": west + 0.002, "lat": south + 0.001},
                {"lon": west + 0.001, "lat": south + 0.001},
            ]},
            {"type": "way", "id": 4, "tags": {"leisure": "park"}, "geometry": [
                {"lon": east - 0.002, "lat": north - 0.002},
                {"lon": east - 0.002, "lat": north - 0.001},
                {"lon": east - 0.001, "lat": north - 0.001},
                {"lon": east - 0.001, "lat": north - 0.002},
                {"lon": east - 0.002, "lat": north - 0.002},
            ]},
        ]
    }


def config() -> dict:
    config_path = ROOT / "tools" / "prepare-parcel" / "parcels.yaml"
    return yaml.safe_load(config_path.read_text("utf-8"))["beijing_cbd"]


def test_synthetic_pipeline_is_deterministic_and_priority_correct(tmp_path):
    raw_path = tmp_path / "raw.json"
    raw_path.write_text(json.dumps(synthetic_raw()), "utf-8")
    first = tmp_path / "beijing_cbd"
    second = tmp_path / "second"
    stats = PIPELINE.prepare(raw_path, first, config())
    PIPELINE.prepare(raw_path, second, config())
    assert (first / "parcel.json").read_bytes() == (second / "parcel.json").read_bytes()
    assert (first / "buildings.json").read_bytes() == (second / "buildings.json").read_bytes()
    assert stats["stats"]["buildings"] == 1
    assert stats["stats"]["height_sources"] == {"osm-levels": 1}

    parcel = Parcel.model_validate_json((first / "parcel.json").read_text("utf-8"))
    buildings = BuildingsFile.model_validate_json((first / "buildings.json").read_text("utf-8"))
    NetworkFile.model_validate_json((first / "network.json").read_text("utf-8"))
    assert parcel.crs == "EPSG:32650"
    assert parcel.origin and len(parcel.origin) == 2
    assert "river" in {cell.value for row in parcel.terrain for cell in row}
    assert "forest" in {cell.value for row in parcel.terrain for cell in row}
    assets = [asset for chunk in buildings.chunks.values() for asset in chunk]
    assert len(assets) == 1
    assert assets[0].height_m == 24
    assert assets[0].population > 0
    for r, c in assets[0].cells:
        assert parcel.terrain[r][c].value == "occupied"  # 覆盖穿过同一格的道路

    loaded, loaded_assets = load_parcel("beijing_cbd", None, tmp_path, load_sim_config())
    assert loaded.data_version == parcel.data_version
    assert set(loaded_assets) == {assets[0].asset_id}


def test_height_fallback_and_named_landmarks():
    assert PIPELINE.height_and_levels({"building": "apartments"}) == (18.0, 6, "default-levels")
    office = {"building": "office", "height": "528 m"}
    height, levels, _source = PIPELINE.height_and_levels(office)
    assert height == 528.0 and round(levels, 1) == 150.9
    assert PIPELINE.height_and_levels({"building": "office", "name": "中国尊"})[0] == 528
    ordinary = PIPELINE.height_and_levels({"building": "office", "name": "普通办公楼"})
    assert ordinary[2] == "default-levels"


def test_actual_beijing_package_models_budgets_and_landmarks():
    root = ROOT / "data" / "parcels"
    path = root / "beijing_cbd"
    parcel, assets = load_parcel("beijing_cbd", None, root, load_sim_config())
    raw_buildings = json.loads((path / "buildings.json").read_text("utf-8"))
    BuildingsFile.model_validate(raw_buildings)
    network = NetworkFile.model_validate_json((path / "network.json").read_text("utf-8"))
    source = json.loads((path / "source.json").read_text("utf-8"))
    assert parcel.parcel_id == "beijing_cbd"
    assert parcel.size == 48 and parcel.cell_size_m == 50
    assert len(assets) >= 900
    assert sum(cell.value == "occupied" for row in parcel.terrain for cell in row) >= 1000
    assert network.features
    assert source["stats"]["raw_elements"] == 2246
    assert source["raw_sha256"] == (
        "19b2d414109a3e77219bcaa5da67a6347ec9aa3fb356981cfd109ab1709ed3e5"
    )
    assert (path / "parcel.json").stat().st_size < 200_000
    assert (path / "buildings.json").stat().st_size < 2_000_000
    assert (path / "network.json").stat().st_size < 300_000
    assert (path / "LICENSE.txt").is_file()
    assert "OpenStreetMap" in (path / "LICENSE.txt").read_text("utf-8")
    assert sum(a["height_m"] for chunks in raw_buildings["chunks"].values() for a in chunks) > 0
    landmarks = [
        asset for chunk in raw_buildings["chunks"].values() for asset in chunk
        if asset.get("height_source") == "landmark-manual"
    ]
    assert landmarks
    assert {asset["height_m"] for asset in landmarks} <= {234.0, 330.0, 528.0}
    assert all(
        0 <= x <= 2400 and 0 <= y <= 2400
        for chunk in raw_buildings["chunks"].values()
        for asset in chunk for x, y in asset["footprint"]
    )
