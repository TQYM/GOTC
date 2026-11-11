"""建筑搬迁：C:S 的 RelocateBuilding（保留建成度/名称/历史标志，只换占格）。"""

import pytest
from fastapi.testclient import TestClient

from app.api import saves as saves_module
from app.config import Settings, load_sim_config
from app.core.repository import SaveRepository
from app.core.service import SaveService
from app.main import app

SEED = 882314


@pytest.fixture()
def client(tmp_path):
    settings = Settings(
        database_path=str(tmp_path / "city20.db"),
        parcel_data_dir=str(tmp_path / "parcels"),
        llm_api_key=None,
    )
    fresh = SaveService(
        SaveRepository(settings.database_path), config=load_sim_config(), settings=settings
    )
    original = saves_module.service
    saves_module.service = fresh
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        saves_module.service = original


def create(client: TestClient) -> str:
    response = client.post("/api/saves", json={"seed": SEED, "parcel_id": "sandbox"})
    assert response.status_code == 201, response.text
    code = response.json()["city_code"]
    assert client.post(f"/api/saves/{code}/start").status_code == 200
    return code


def free_anchor(client: TestClient, code: str, skip: set[tuple[int, int]]) -> list[int]:
    """找一个既没被占用、也能真正放下的锚点（地形可能是河道/道路）。"""
    state = client.get(f"/api/saves/{code}").json()
    occupied = {(c[0], c[1]) for tile in state["tiles"] for c in tile["cells"]}
    occupied |= skip
    for r in range(6, 40):
        for c in range(6, 40):
            if (r, c) in occupied:
                continue
            probe = client.post(
                f"/api/saves/{code}/place",
                json={"type": "res_low", "anchor": [r, c], "client_op_id": f"probe-{r}-{c}"},
            )
            if probe.status_code == 200:
                tile_id = probe.json()["tile"]["id"]
                client.post(
                    f"/api/saves/{code}/remove",
                    json={"tile_id": tile_id, "client_op_id": f"unprobe-{r}-{c}"},
                )
                return [r, c]
    raise AssertionError("找不到可放置的空位")


def test_relocate_keeps_building_and_charges_fee(client: TestClient) -> None:
    code = create(client)
    placed = client.post(
        f"/api/saves/{code}/place",
        json={"type": "res_mid", "anchor": [10, 10], "client_op_id": "p1"},
    )
    assert placed.status_code == 200, placed.text
    tile_id = placed.json()["tile"]["id"]
    client.post(
        f"/api/saves/{code}/rename",
        json={"tile_id": tile_id, "name": "老宅", "client_op_id": "r1"},
    )
    before = client.get(f"/api/saves/{code}").json()
    funds_before = before["metrics"]["funds"]
    target = free_anchor(client, code, {(10, 10)})

    moved = client.post(
        f"/api/saves/{code}/relocate",
        json={"tile_id": tile_id, "anchor": target, "client_op_id": "m1"},
    )
    assert moved.status_code == 200, moved.text
    tile = moved.json()["tile"]
    assert tile["anchor"] == target
    assert tile["name"] == "老宅"
    assert tile["id"] == tile_id

    after = client.get(f"/api/saves/{code}").json()
    assert after["metrics"]["funds"] < funds_before
    placed_cells = {(c[0], c[1]) for t in after["tiles"] for c in t["cells"]}
    assert (10, 10) not in placed_cells
    assert (target[0], target[1]) in placed_cells


def test_relocate_rejects_occupied_target(client: TestClient) -> None:
    code = create(client)
    first = client.post(
        f"/api/saves/{code}/place",
        json={"type": "res_low", "anchor": [10, 10], "client_op_id": "p1"},
    )
    assert first.status_code == 200, first.text
    tile_id = first.json()["tile"]["id"]
    target = free_anchor(client, code, {(10, 10)})
    second = client.post(
        f"/api/saves/{code}/place",
        json={"type": "res_low", "anchor": target, "client_op_id": "p2"},
    )
    assert second.status_code == 200, second.text

    response = client.post(
        f"/api/saves/{code}/relocate",
        json={"tile_id": tile_id, "anchor": target, "client_op_id": "m1"},
    )
    assert response.status_code in (400, 409, 422), response.text


def test_relocate_rejects_unknown_tile(client: TestClient) -> None:
    code = create(client)
    response = client.post(
        f"/api/saves/{code}/relocate",
        json={"tile_id": "tile-nope", "anchor": [12, 12], "client_op_id": "m1"},
    )
    assert response.status_code in (400, 404, 422), response.text
